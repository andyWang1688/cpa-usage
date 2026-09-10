import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
from urllib.request import urlopen
import install

ROOT=Path(__file__).resolve().parent.parent

class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.base=Path(self.tmp.name);self.home=self.base/'home';self.bin=self.base/'bin'
        self.env={**os.environ,'CPA_USAGE_HOME':str(self.home),'CPA_USAGE_BIN':str(self.bin)}
        with socket.socket() as s:s.bind(('127.0.0.1',0));self.port=s.getsockname()[1]
    def tearDown(self):
        if (self.bin/'cpa-usage').exists(): self.command('stop',check=False)
        self.tmp.cleanup()
    def archive(self,version,broken=False):
        path=self.base/f'{version}.tar.gz'
        with tarfile.open(path,'w:gz') as tar:
            for name in ('report.py','cli.py','install.py','config.env.example'):
                content=(ROOT/name).read_bytes()
                if name in ('report.py', 'cli.py'):
                    content=b'import faulthandler; faulthandler.dump_traceback_later(8)\n'+content
                if name=='report.py' and broken:content=b'import sys;sys.exit(2)'
                self.add(tar,name,content)
            self.add(tar,'VERSION',version.encode())
            self.add(tar,'dist/index.html',b'<html>test</html>')
        return path
    def add(self,tar,name,content):
        info=tarfile.TarInfo(name);info.size=len(content);tar.addfile(info,io.BytesIO(content))
    def command(self,*args,check=True):
        try:
            return subprocess.run([str(self.bin/'cpa-usage'),*args],env=self.env,text=True,capture_output=True,check=check,timeout=30)
        except subprocess.TimeoutExpired as exc:
            log=self.home/'service.log'
            raise AssertionError(f'CLI timeout: {exc.stderr!r}; service log: {log.read_text() if log.exists() else 'none'}') from exc
    def test_install_start_update_rollback_preserve_data(self):
        install.install_archive(self.archive('0.1.0'),self.home,self.bin)
        config=f'CPA_MGMT_URL=http://127.0.0.1:1\nCPA_MGMT_KEY=\nREPORT_PORT={self.port}\nDB_PATH=usage.sqlite\n'
        (self.home/'config.env').write_text(config)
        db=self.home/'usage.sqlite'
        with sqlite3.connect(db) as conn:conn.execute('CREATE TABLE marker(value TEXT)');conn.execute("INSERT INTO marker VALUES('keep-me')")
        self.command('start'); first=json.loads((self.home/'service.pid').read_text())
        self.command('start');self.assertEqual(first,json.loads((self.home/'service.pid').read_text()))
        with urlopen(f'http://127.0.0.1:{self.port}/api/health') as r:self.assertEqual(json.load(r)['version'],'0.1.0')
        good=self.archive('0.1.1'); bad=self.archive('0.1.2',broken=True)
        def update(path,version):
            code=f"import cli; from pathlib import Path; cli.fetch_release=lambda v,d:(Path({str(path)!r}),{version!r}); cli.update('latest')"
            return subprocess.run([sys.executable,'-c',code],cwd=self.home/'current',env=self.env,capture_output=True,text=True,timeout=40)
        result=update(good,'0.1.1');self.assertEqual(result.returncode,0,result.stderr)
        with urlopen(f'http://127.0.0.1:{self.port}/api/health') as r:self.assertEqual(json.load(r)['version'],'0.1.1')
        result=update(bad,'0.1.2');self.assertNotEqual(result.returncode,0)
        with urlopen(f'http://127.0.0.1:{self.port}/api/health') as r:self.assertEqual(json.load(r)['version'],'0.1.1')
        self.assertEqual((self.home/'config.env').read_text(),config)
        with sqlite3.connect(db) as conn:self.assertEqual(conn.execute('SELECT value FROM marker').fetchone()[0],'keep-me')
        self.command('stop');self.assertIn('stopped',self.command('status').stdout)
    def test_reject_path_traversal(self):
        path=self.base/'unsafe.tar.gz'
        with tarfile.open(path,'w:gz') as tar:self.add(tar,'../../escaped',b'bad')
        with self.assertRaises(ValueError):install.install_archive(path,self.home,self.bin)
        self.assertFalse((self.base/'escaped').exists())

if __name__=='__main__':unittest.main()
