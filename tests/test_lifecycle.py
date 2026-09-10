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
            raise AssertionError(f"CLI timeout: {exc.stderr!r}; service log: {log.read_text() if log.exists() else 'none'}") from exc
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
    def test_migrate_legacy_home_preserves_data_and_restarts(self):
        self.home = self.base / '.local/share/cpa-usage'
        self.env.update(HOME=str(self.base), CPA_USAGE_HOME=str(self.home))
        install.install_archive(self.archive('0.1.1'), self.home, self.bin)
        config = f'CPA_MGMT_URL=http://127.0.0.1:1\nCPA_MGMT_KEY=\nREPORT_PORT={self.port}\nDB_PATH={self.home / "usage.sqlite"}\n'
        (self.home / 'config.env').write_text(config)
        with sqlite3.connect(self.home / 'usage.sqlite') as conn:
            conn.execute('CREATE TABLE marker(value TEXT)')
            conn.execute("INSERT INTO marker VALUES('keep-through-migration')")
        self.command('start')
        old_pid = json.loads((self.home / 'service.pid').read_text())['pid']
        result = self.command('migrate')
        target = (self.base / '.cpa-usage').resolve()
        self.assertIn(str(target), result.stdout)
        self.assertTrue((self.home / 'usage.sqlite').exists())
        self.assertEqual((target / 'current').resolve(), target / 'releases/0.1.1')
        self.assertIn(str(target / 'usage.sqlite'), (target / 'config.env').read_text())
        self.assertEqual((target / 'config.env').stat().st_mode & 0o777, 0o600)
        with sqlite3.connect(target / 'usage.sqlite') as conn:
            self.assertEqual(conn.execute('SELECT value FROM marker').fetchone()[0], 'keep-through-migration')
        self.assertNotEqual(json.loads((target / 'service.pid').read_text())['pid'], old_pid)
        self.assertIn('running', self.command('status').stdout)
        self.assertIn('already', self.command('migrate').stdout.lower())

    def test_migration_never_overwrites_existing_target(self):
        self.home = self.base / '.local/share/cpa-usage'
        self.env.update(HOME=str(self.base), CPA_USAGE_HOME=str(self.home))
        install.install_archive(self.archive('0.1.1'), self.home, self.bin)
        target = (self.base / '.cpa-usage').resolve()
        target.mkdir()
        (target / 'keep').write_text('untouched')
        result = self.command('migrate', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Target already exists', result.stderr)
        self.assertEqual((target / 'keep').read_text(), 'untouched')
        self.assertIn(str(self.home), (self.bin / 'cpa-usage').read_text())

    def test_default_home_is_direct_hidden_directory(self):
        env = {**os.environ, 'HOME': str(self.base)}
        env.pop('CPA_USAGE_HOME', None)
        result = subprocess.check_output([sys.executable, '-c', 'import report; print(report.HOME)'], cwd=ROOT, env=env, text=True)
        self.assertEqual(result.strip(), str((self.base / '.cpa-usage').resolve()))

    def test_migration_failed_start_restores_old_service(self):
        self.home = self.base / '.local/share/cpa-usage'
        self.env.update(HOME=str(self.base), CPA_USAGE_HOME=str(self.home))
        install.install_archive(self.archive('0.1.1'), self.home, self.bin)
        (self.home / 'config.env').write_text(f'REPORT_PORT={self.port}\nCPA_MGMT_KEY=\n')
        script = self.home / 'current/report.py'
        script.write_text("import os, sys\nif os.environ.get('CPA_USAGE_HOME', '').endswith('/.cpa-usage'): sys.exit(2)\n" + script.read_text())
        self.command('start')
        result = self.command('migrate', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(str(self.home.resolve()), (self.bin / 'cpa-usage').read_text())
        self.assertIn('running', self.command('status').stdout)

    def test_migration_preserves_external_database_setting(self):
        install.install_archive(self.archive('0.1.1'), self.home, self.bin)
        external = self.base / 'external.sqlite'
        with sqlite3.connect(external) as conn:
            conn.execute('CREATE TABLE marker(value TEXT)')
            conn.execute("INSERT INTO marker VALUES('external-stays-put')")
        config = f'DB_PATH={external}\nCPA_MGMT_KEY=fixture-only\n'
        (self.home / 'config.env').write_text(config)
        target = (self.base / '.cpa-usage').resolve()
        install.migrate_home(self.home.resolve(), target, self.bin.resolve())
        self.assertEqual((target / 'config.env').read_text(), config)
        self.assertFalse((target / 'usage.sqlite').exists())
        with sqlite3.connect(external) as conn:
            self.assertEqual(conn.execute('SELECT value FROM marker').fetchone()[0], 'external-stays-put')

    def test_installer_detects_legacy_before_creating_empty_home(self):
        legacy = self.base / '.local/share/cpa-usage/current'
        legacy.mkdir(parents=True)
        env = {**os.environ, 'HOME': str(self.base), 'PYTHON': sys.executable}
        env.pop('CPA_USAGE_HOME', None)
        result = subprocess.run(['sh', str(ROOT / 'install.sh')], env=env, capture_output=True, text=True, check=True)
        self.assertIn('cpa-usage update && cpa-usage migrate', result.stdout)
        self.assertFalse((self.base / '.cpa-usage').exists())

    def test_reject_path_traversal(self):
        path=self.base/'unsafe.tar.gz'
        with tarfile.open(path,'w:gz') as tar:self.add(tar,'../../escaped',b'bad')
        with self.assertRaises(ValueError):install.install_archive(path,self.home,self.bin)
        self.assertFalse((self.base/'escaped').exists())

if __name__=='__main__':unittest.main()
