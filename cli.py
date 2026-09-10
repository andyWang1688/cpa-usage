#!/usr/bin/env python3
import argparse
import fcntl
import getpass
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen
from urllib.parse import urlparse
from report import HOME, VERSION, load_env
from install import fetch_release, install_archive, switch

PID = HOME / 'service.pid'
LOG = HOME / 'service.log'


def running():
    try:
        record = json.loads(PID.read_text())
        pid, script = record['pid'], record['script']
        # A stale PID must never signal an unrelated process.
        command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'args='], text=True).strip()
        return record if script in command and 'report.py' in command else None
    except (FileNotFoundError, ValueError, KeyError, subprocess.CalledProcessError):
        return None


def start():
    if running():
        print('cpa-usage already running')
        return
    env = load_env()
    port = int(env['REPORT_PORT'])
    script = str((HOME / 'current/report.py').resolve())
    with LOG.open('ab') as log:
        proc = subprocess.Popen([sys.executable, '-u', script], stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    PID.write_text(json.dumps({'pid': proc.pid, 'script': script}))
    for _ in range(60):
        if proc.poll() is not None:
            PID.unlink(missing_ok=True)
            raise RuntimeError(f'Service failed to start; inspect {LOG}')
        try:
            with urlopen(f'http://127.0.0.1:{port}/api/health', timeout=1) as response:
                health = json.load(response)
                if health.get('pid') == proc.pid and health.get('service') == 'cpa-usage':
                    print(f"cpa-usage {health['version']} started: http://127.0.0.1:{port}")
                    return
        except Exception:
            pass
        time.sleep(.1)
    proc.terminate()
    proc.wait(timeout=10)
    PID.unlink(missing_ok=True)
    raise RuntimeError('Service health check timed out')


def stop():
    record = running()
    if record:
        os.kill(record['pid'], signal.SIGTERM)
        for _ in range(100):
            if not running():
                break
            time.sleep(.1)
        else:
            raise RuntimeError('Service did not stop; no forced kill performed')
    PID.unlink(missing_ok=True)
    print('cpa-usage stopped')


def configure():
    env = load_env()
    address = input(f"CPA URL [{env['CPA_MGMT_URL']}]: ").strip() or env['CPA_MGMT_URL']
    parsed = urlparse(address)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
        raise ValueError('Invalid CPA URL')
    if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Remote CPA requires HTTPS to protect the management key')
    key = getpass.getpass('Management key [Enter keeps existing]: ').strip() or env.get('CPA_MGMT_KEY', '')
    port = input(f"Dashboard port [{env['REPORT_PORT']}]: ").strip() or env['REPORT_PORT']
    if not 1024 <= int(port) <= 65535:
        raise ValueError('Port must be 1024..65535')
    env.update(CPA_MGMT_URL=address, CPA_MGMT_KEY=key, REPORT_PORT=port)
    if any('\n' in v or '\r' in v for v in env.values()):
        raise ValueError('Multiline configuration is not supported')
    temporary = HOME / '.config-next'
    temporary.write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
    temporary.chmod(0o600)
    temporary.replace(HOME / 'config.env')
    if running():
        stop()
        start()
    print('Configuration saved locally')


def update(version):
    with tempfile.TemporaryDirectory(prefix='cpa-usage-update-') as temporary:
        archive, target_version = fetch_release(version, Path(temporary))
        if target_version == VERSION:
            print(f'Already on {VERSION}')
            return
        previous = (HOME / 'current').resolve()
        active = bool(running())
        if active:
            stop()
        try:
            install_archive(archive, HOME, Path(os.environ.get('CPA_USAGE_BIN', Path.home() / '.local/bin')))
            if active:
                start()
        except Exception:
            switch(HOME, previous)
            if active:
                start()
            raise
        print(f'Updated to {target_version}; configuration and database preserved')


def main():
    parser = argparse.ArgumentParser(prog='cpa-usage', description='Local CLIProxyAPI usage dashboard')
    parser.add_argument('command', choices=['start','stop','restart','status','logs','configure','update','version'])
    parser.add_argument('target', nargs='?', default='latest', help='Update target: latest or vX.Y.Z')
    args = parser.parse_args()
    HOME.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.umask(0o077)
    if args.command == 'logs':
        LOG.touch(exist_ok=True)
        os.execvp('tail', ['tail','-n','100','-f',str(LOG)])
    with (HOME / 'command.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == 'start': start()
        elif args.command == 'stop': stop()
        elif args.command == 'restart': stop(); start()
        elif args.command == 'configure': configure()
        elif args.command == 'update': update(args.target)
        elif args.command == 'version': print(VERSION)
        elif args.command == 'status':
            record = running()
            print(f"cpa-usage {VERSION}: " + (f"running (PID {record['pid']})" if record else 'stopped'))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        print(f'cpa-usage: {exc}', file=sys.stderr)
        sys.exit(1)
