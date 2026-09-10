"""Explicit allowlist prevents accidentally publishing local secrets or databases."""
import hashlib
from pathlib import Path
import sys
import tarfile

root = Path(__file__).resolve().parent.parent
version = (root / 'VERSION').read_text().strip()
out = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/cpa-usage-release').resolve()
out.mkdir(parents=True, exist_ok=True)
archive = out / f'cpa-usage-v{version}.tar.gz'
with tarfile.open(archive, 'w:gz') as tar:
    for name in ('VERSION','LICENSE','THIRD_PARTY_NOTICES.md','README.md','report.py','cli.py','install.py','config.env.example'):
        tar.add(root / name, arcname=name)
    tar.add(root / 'frontend/dist', arcname='dist')
(out / 'SHA256SUMS').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
print(archive)
