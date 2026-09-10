#!/usr/bin/env python3
"""Local-only CPA usage collector and static dashboard. Python standard library only."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import mimetypes
import os
import re
from pathlib import Path
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

BASE = Path(__file__).resolve().parent
HOME = Path(os.environ.get('CPA_USAGE_HOME', Path.home() / '.local/share/cpa-usage')).expanduser().resolve()
VERSION = (BASE / 'VERSION').read_text().strip()
COLLECT_LOCK = threading.Lock()
LAST = {'ts': None, 'n': 0, 'err': None}


def load_env(home=HOME):
    env = {'CPA_MGMT_URL': 'http://127.0.0.1:8317', 'REPORT_PORT': '8899'}
    path = home / 'config.env'
    if path.exists():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('\"').strip("'")
    db = Path(env.get('DB_PATH', 'usage.sqlite')).expanduser()
    env['DB_PATH'] = str(db if db.is_absolute() else home / db)
    return env


@contextmanager
def connect_db(env):
    conn = sqlite3.connect(env['DB_PATH'], timeout=30)
    conn.execute('CREATE TABLE IF NOT EXISTS usage_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, dedup TEXT UNIQUE, payload TEXT)')
    try:
        yield conn
    finally:
        conn.close()


def persist(conn, events):
    n = 0
    for event in events:
        if not isinstance(event, dict):
            raise ValueError('Queue contains a non-object event')
        payload = json.dumps(event, sort_keys=True, ensure_ascii=False)
        ts = event.get('timestamp') or event.get('ts') or datetime.now().astimezone().isoformat()
        n += conn.execute('INSERT OR IGNORE INTO usage_events(ts,dedup,payload) VALUES(?,?,?)',
                          (str(ts), hashlib.sha1(payload.encode()).hexdigest(), payload)).rowcount
    conn.commit()
    return n


def fetch_cpa(env):
    req = Request(env['CPA_MGMT_URL'].rstrip('/') + '/v0/management/usage-queue',
                  headers={'Authorization': 'Bearer ' + env['CPA_MGMT_KEY']})
    with urlopen(req, timeout=15) as res:
        return json.load(res)


def collect_once(env):
    with COLLECT_LOCK:
        n, error = 0, None
        if not env.get('CPA_MGMT_KEY'):
            LAST.update(err='未配置 CPA management key，请运行 cpa-usage configure')
            return 0
        try:
            with connect_db(env) as conn:
                for _ in range(600):
                    data = fetch_cpa(env)
                    if isinstance(data, dict):
                        if data.get('error'):
                            raise ValueError('CPA queue returned an error')
                        # CPA versions may wrap a batch, or return one event directly.
                        if 'timestamp' in data and ('tokens' in data or 'model' in data):
                            data = [data]
                        else:
                            data = next((data[k] for k in ('items', 'events', 'usage', 'queue') if k in data), None)
                    if data is None or data == []:
                        break
                    if not isinstance(data, list):
                        raise ValueError('Unsupported CPA queue response')
                    # Commit each destructive queue read before asking for the next batch.
                    n += persist(conn, data)
                else:
                    error = '本轮达到 600 批采集上限，下轮继续'
        except Exception as exc:
            # Never log upstream bodies or URLs, which could contain credentials.
            error = f'采集失败：{type(exc).__name__}'
        LAST.update(ts=datetime.now().astimezone().isoformat(), n=n, err=error)
        return n


def collector_loop(env):
    while True:
        collect_once(env)
        time.sleep(15)


def parse_time(value):
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if s.replace('.', '', 1).isdigit() and len(s) != 10:
        return float(s)
    if s.isdigit() and len(s) == 10:
        return float(s)
    s = re.sub(r'\.(\d+)', lambda m: '.' + (m.group(1) + '000000')[:6], s)
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def bounds(start, end):
    now = datetime.now()
    a = datetime.strptime(start, '%Y-%m-%d') if start else (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    b = datetime.strptime(end, '%Y-%m-%d') if end else now.replace(hour=0, minute=0, second=0, microsecond=0)
    if a > b:
        raise ValueError('开始日期不能晚于结束日期')
    return a.timestamp(), (b + timedelta(days=1)).timestamp()


def number(value):
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def normalize(event, stored_ts):
    ts = parse_time(event.get('timestamp') or event.get('ts') or stored_ts)
    t = event.get('tokens') or {}
    source = str(event.get('api_key') or event.get('source') or '')
    # Stable grouping without exposing any part of API credentials to the browser.
    key = 'key-' + hashlib.sha256(source.encode()).hexdigest()[:10] if source else '未知 Key'
    return {'ts': ts, 'model': str(event.get('model') or event.get('alias') or event.get('model_name') or 'unknown'),
            'key': key, 'input': number(t.get('input_tokens', event.get('input_tokens'))),
            'output': number(t.get('output_tokens', event.get('output_tokens'))),
            'cache': number(t.get('cache_read_tokens', t.get('cached_tokens', event.get('cached_tokens')))),
            'reasoning': number(t.get('reasoning_tokens')), 'failed': event.get('failed') is True,
            'latency_ms': number(event.get('latency_ms')), 'ttft_ms': number(event.get('ttft_ms'))}


def usage(env, start, end, bucket):
    if bucket not in ('hour', 'day', 'month'):
        raise ValueError('无效时间粒度')
    a, b = bounds(start, end)
    events, bins, skipped = [], {}, 0
    with connect_db(env) as conn:
        for stored_ts, payload in conn.execute('SELECT ts,payload FROM usage_events ORDER BY id'):
            try:
                e = normalize(json.loads(payload), stored_ts)
                if not a <= e['ts'] < b:
                    continue
            except (ValueError, TypeError, AttributeError, OverflowError):
                skipped += 1
                continue
            events.append(e)
            label = datetime.fromtimestamp(e['ts']).strftime({'hour': '%Y-%m-%d %H:00', 'day': '%Y-%m-%d', 'month': '%Y-%m'}[bucket])
            row = bins.setdefault(label, {'label': label, 'input': 0, 'output': 0, 'cache': 0, 'requests': 0})
            for k in ('input', 'output', 'cache'):
                row[k] += e[k]
            row['requests'] += 1
    return {'events': events, 'buckets': [bins[k] for k in sorted(bins)], 'collected_at': LAST['ts'],
            'collect_err': LAST['err'], 'skipped': skipped, 'version': VERSION, 'configured': bool(env.get('CPA_MGMT_KEY')),
            'timezone': datetime.now().astimezone().tzname()}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, body, content_type='application/json; charset=utf-8', status=200):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def allowed(self):
        host = self.headers.get('Host', '')
        port = self.server.server_port
        allowed = {f'127.0.0.1:{port}', f'localhost:{port}'}
        origin = self.headers.get('Origin')
        return host in allowed and (not origin or origin in {'http://' + h for h in allowed})

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if not self.allowed() or self.headers.get('X-CPA-Usage') != '1':
            return self.reply({'error': 'Forbidden'}, status=403)
        if urlparse(self.path).path != '/api/collect':
            return self.reply({'error': 'Not found'}, status=404)
        collect_once(self.server.env)
        self.reply({'collected_at': LAST['ts'], 'collect_err': LAST['err']})

    def do_GET(self):
        if not self.allowed():
            return self.reply({'error': 'Forbidden'}, status=403)
        parsed = urlparse(self.path)
        if parsed.path == '/api/health':
            return self.reply({'service': 'cpa-usage', 'version': VERSION, 'pid': os.getpid()})
        if parsed.path == '/api/usage':
            q = parse_qs(parsed.query)
            try:
                return self.reply(usage(self.server.env, q.get('start', [''])[0], q.get('end', [''])[0], q.get('bucket', ['day'])[0]))
            except ValueError as exc:
                return self.reply({'error': str(exc)}, status=400)
        if parsed.path.startswith('/api/'):
            return self.reply({'error': 'Not found'}, status=404)
        dist = (BASE / 'dist').resolve()
        target = (dist / unquote(parsed.path).lstrip('/')).resolve()
        if not target.is_relative_to(dist):
            return self.reply({'error': 'Forbidden'}, status=403)
        if parsed.path == '/':
            target = dist / 'index.html'
        if not target.is_file():
            return self.reply({'error': 'Not found'}, status=404)
        self.reply(target.read_bytes(), mimetypes.guess_type(str(target))[0] or 'application/octet-stream')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-collector', action='store_true', help='Isolated preview/test server only')
    args = parser.parse_args()
    HOME.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.umask(0o077)
    with (HOME / 'service.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        env = load_env()
        server = ThreadingHTTPServer(('127.0.0.1', int(env['REPORT_PORT'])), Handler)
        server.env = env
        with connect_db(env):
            pass
        # Bind and lock before starting a destructive queue consumer.
        if not args.no_collector:
            threading.Thread(target=collector_loop, args=(env,), daemon=True).start()
        print(f'cpa-usage {VERSION}: http://127.0.0.1:{server.server_port}', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
