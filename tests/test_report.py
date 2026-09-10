import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer
import report


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = {'DB_PATH': str(Path(self.tmp.name)/'usage.sqlite'), 'CPA_MGMT_KEY':'test-only', 'CPA_MGMT_URL':'http://127.0.0.1:1'}
    def tearDown(self):
        self.tmp.cleanup()
    def seed(self, events):
        with report.connect_db(self.env) as conn:
            return report.persist(conn, events)
    def test_unsorted_buckets_and_zero_token_failure(self):
        self.seed([{'timestamp': ts, 'model':'fixture', 'failed':fail, 'tokens':{'input_tokens':n}} for ts,n,fail in [
            ('2026-01-01T10:00:00',10,False),('2026-01-02T10:00:00',20,False),('2026-01-01T11:00:00',30,False),('2026-01-02T11:00:00',0,True)]])
        data=report.usage(self.env,'2026-01-01','2026-01-02','day')
        self.assertEqual([x['input'] for x in data['buckets']],[40,20])
        self.assertEqual(len(data['events']),4)
        self.assertTrue(data['events'][-1]['failed'])
    def test_end_date_fraction_and_next_day_excluded(self):
        self.seed([{'timestamp':t,'tokens':{'input_tokens':1}} for t in ['2026-01-01T23:59:59.99999','2026-01-02T00:00:00']])
        self.assertEqual(len(report.usage(self.env,'2026-01-01','2026-01-01','day')['events']),1)
    def test_invalid_date_and_bucket(self):
        for a,b,k in [('2026-01-02','2026-01-01','day'),('bad','','day'),('','','invalid')]:
            with self.assertRaises(ValueError): report.usage(self.env,a,b,k)
    def test_key_redaction_and_dedup(self):
        event={'timestamp':'2026-01-01T00:00:00','source':'secret-fixture-value','tokens':{'input_tokens':100,'cache_read_tokens':60,'output_tokens':20,'reasoning_tokens':5}}
        self.assertEqual(self.seed([event,event]),1)
        result=report.usage(self.env,'2026-01-01','2026-01-01','day')
        self.assertNotIn('secret-fixture-value',json.dumps(result))
        self.assertEqual(result['buckets'][0]['input'],100)
    def test_queue_is_drained_and_error_not_erased(self):
        event={'timestamp':'2026-01-01T00:00:00','model':'fixture','tokens':{}}
        with patch('report.fetch_cpa',side_effect=[[event],OSError('do not leak credentials')]) as fetch:
            self.assertEqual(report.collect_once(self.env),1)
            self.assertEqual(fetch.call_count,2)
            self.assertIsNotNone(report.LAST['err'])
            self.assertNotIn('credentials',report.LAST['err'])
        with patch('report.fetch_cpa',return_value=[]):
            report.collect_once(self.env)
            self.assertIsNone(report.LAST['err'])
    def test_invalid_timestamp_skipped(self):
        self.seed([{'timestamp':'not-a-date','tokens':{'input_tokens':999}}])
        data=report.usage(self.env,'2026-01-01','2026-01-01','day')
        self.assertEqual(data['events'],[])
        self.assertEqual(data['skipped'],1)
    def test_loopback_start_does_not_require_reverse_dns(self):
        with patch('socket.getfqdn', side_effect=AssertionError('Unexpected reverse DNS during local bind')):
            server = report.LocalHTTPServer(('127.0.0.1', 0), report.Handler)
            server.server_close()

    def test_http_assets_and_local_only(self):
        base=Path(self.tmp.name); (base/'dist/assets').mkdir(parents=True)
        (base/'dist/index.html').write_text('<html>fixture</html>')
        (base/'dist/assets/test.js').write_text('console.log(1)')
        with patch('report.BASE',base):
            server=report.LocalHTTPServer(('127.0.0.1',0),report.Handler); server.env=self.env
            thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
            url=f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(url+'/assets/test.js') as r:
                    self.assertIn('javascript',r.headers['Content-Type']); self.assertEqual(r.read(),b'console.log(1)')
                with urlopen(Request(url+'/',method='HEAD')) as r: self.assertEqual(r.status,200)
                for path,headers,status in [('/assets/missing.js',{},404),('/%2e%2e/config.env',{},403),('/api/usage',{'Host':'evil.invalid'},403),('/api/usage',{'Origin':'https://evil.invalid'},403)]:
                    with self.assertRaises(HTTPError) as exc: urlopen(Request(url+path,headers=headers))
                    self.assertEqual(exc.exception.code,status)
            finally:
                server.shutdown();server.server_close();thread.join()

if __name__=='__main__': unittest.main()
