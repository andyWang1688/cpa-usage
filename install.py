#!/usr/bin/env python3
"""Versioned release installation. Never overwrite user configuration or database."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import Request, urlopen

REPO = 'andyWang1688/cpa-usage'


def download(url, path):
    req = Request(url, headers={'User-Agent': 'cpa-usage', 'Accept': 'application/vnd.github+json'})
    with urlopen(req, timeout=60) as response, open(path, 'wb') as output:
        shutil.copyfileobj(response, output)


def switch(home, target):
    temporary = home / '.current-next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(home / 'current')


def prepare_runtime(home):
    python = home / 'venv/bin/python'
    if not python.exists():
        subprocess.run([sys.executable, '-m', 'venv', '--without-pip', str(home / 'venv')], check=True)
    return python


def write_launcher(home, bin_dir):
    bin_dir.mkdir(parents=True, exist_ok=True)
    launcher = bin_dir / 'cpa-usage'
    temporary = bin_dir / '.cpa-usage-next'
    temporary.write_text('#!/bin/sh\nexport CPA_USAGE_HOME=' + shlex.quote(str(home)) + '\nexec ' + shlex.quote(str(home / 'venv/bin/python')) + ' ' + shlex.quote(str(home / 'current/cli.py')) + ' "$@"\n')
    temporary.chmod(0o755)
    temporary.replace(launcher)


def migrate_home(source, target, bin_dir):
    """Copy a stopped legacy installation; keep the source as a rollback copy."""
    from report import load_env

    target.mkdir(mode=0o700)  # Never merge into an existing directory.
    shutil.copytree(source / 'releases', target / 'releases')
    config = (source / 'config.env').read_text()
    db = Path(load_env(source)['DB_PATH']).resolve()
    if db.is_relative_to(source):
        new_db = target / db.relative_to(source)
        if db.exists():
            new_db.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(f'file:{db}?mode=ro', uri=True) as src, sqlite3.connect(new_db) as dst:
                src.backup(dst)
            new_db.chmod(0o600)
        # Keep relative/custom external DB paths; rewrite only an internal absolute path.
        lines = []
        for line in config.splitlines(keepends=True):
            if line.split('=', 1)[0].strip() == 'DB_PATH' and '=' in line:
                value = line.split('=', 1)[1].strip().strip('"').strip("'")
                if Path(value).expanduser().is_absolute():
                    line = 'DB_PATH=' + str(new_db) + '\n'
            lines.append(line)
        config = ''.join(lines)
    (target / 'config.env').write_text(config)
    (target / 'config.env').chmod(0o600)
    if (source / 'service.log').exists():
        shutil.copyfile(source / 'service.log', target / 'service.log')
        (target / 'service.log').chmod(0o600)
    version = (source / 'current/VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid installed version')
    prepare_runtime(target)  # Virtual environments contain absolute paths; recreate it.
    switch(target, target / 'releases' / version)
    write_launcher(target, bin_dir)


def install_archive(archive, home, bin_dir):
    home, bin_dir = Path(home).expanduser().resolve(), Path(bin_dir).expanduser().resolve()
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    releases = home / 'releases'
    releases.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.stage-', dir=releases) as temporary:
        stage = Path(temporary)
        with tarfile.open(archive, 'r:gz') as package:
            for member in package.getmembers():
                target = (stage / member.name).resolve()
                if not target.is_relative_to(stage) or not (member.isfile() or member.isdir()):
                    raise ValueError('Unsafe release archive')
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with package.extractfile(member) as source, target.open('wb') as output:
                        shutil.copyfileobj(source, output)
        required = ('VERSION', 'report.py', 'cli.py', 'install.py', 'config.env.example', 'dist/index.html')
        if not all((stage / p).is_file() for p in required):
            raise ValueError('Incomplete release archive')
        version = (stage / 'VERSION').read_text().strip()
        if not re.fullmatch(r'\d+\.\d+\.\d+', version):
            raise ValueError('Invalid release version')
        dest = releases / version
        if dest.exists():
            raise ValueError(f'Version {version} already installed')
        # Isolated runtime, created once; no pip, npm or network needed at runtime.
        prepare_runtime(home)
        shutil.copytree(stage, dest)
    config = home / 'config.env'
    if not config.exists():
        shutil.copyfile(dest / 'config.env.example', config)
        config.chmod(0o600)
    switch(home, dest)
    write_launcher(home, bin_dir)
    return version


def fetch_release(version, destination):
    if version != 'latest' and not re.fullmatch(r'v?\d+\.\d+\.\d+', version):
        raise ValueError('Expected latest or vX.Y.Z')
    endpoint = 'latest' if version == 'latest' else 'tags/v' + version.lstrip('v')
    metadata = destination / 'release.json'
    download(f'https://api.github.com/repos/{REPO}/releases/{endpoint}', metadata)
    release = json.loads(metadata.read_text())
    tag = release['tag_name']
    if not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
        raise ValueError('Invalid release tag')
    name = f'cpa-usage-{tag}.tar.gz'
    assets = {a['name']: a['browser_download_url'] for a in release['assets']}
    archive, checksum = destination / name, destination / 'SHA256SUMS'
    for filename, path in ((name, archive), ('SHA256SUMS', checksum)):
        url = assets[filename]
        if not url.startswith(f'https://github.com/{REPO}/releases/download/'):
            raise ValueError('Unexpected release asset origin')
        download(url, path)
    entries = dict((parts[1].lstrip('*'), parts[0]) for line in checksum.read_text().splitlines() if len(parts := line.split()) == 2)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != entries.get(name):
        raise ValueError('Release checksum mismatch')
    return archive, tag.lstrip('v')


if __name__ == '__main__':
    if sys.version_info < (3, 10):
        sys.exit('Python 3.10+ required')
    version = install_archive(sys.argv[1], sys.argv[2], sys.argv[3])
    print(f'Installed cpa-usage {version}. Run cpa-usage configure, then cpa-usage start.')
