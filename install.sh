#!/bin/sh
# Install a verified, prebuilt release. No Node.js required on the client.
set -eu
REPO=andyWang1688/cpa-usage
HOME_DIR="${CPA_USAGE_HOME:-$HOME/.local/share/cpa-usage}"
BIN_DIR="${CPA_USAGE_BIN:-$HOME/.local/bin}"
if [ -z "${PYTHON:-}" ]; then
  for candidate in python3.14 python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3,10))' 2>/dev/null; then
      PYTHON="$candidate"
      break
    fi
  done
fi
if [ -z "${PYTHON:-}" ]; then
  echo 'Python 3.10+ required. Install Python or set PYTHON=/absolute/path/to/python3.' >&2
  exit 1
fi
"$PYTHON" -c 'import sys; assert sys.version_info >= (3,10), "Python 3.10+ required"'
if [ -e "$HOME_DIR/current" ]; then
  printf '%s\n' 'Already installed. Run cpa-usage update.'
  exit 0
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
curl -fsSL --retry 3 "https://api.github.com/repos/$REPO/releases/latest" -o "$TMP/release.json"
TAG=$("$PYTHON" -c 'import json,sys,re; t=json.load(open(sys.argv[1]))["tag_name"]; assert re.fullmatch(r"v\d+\.\d+\.\d+", t); print(t)' "$TMP/release.json")
ASSET="cpa-usage-$TAG.tar.gz"
URL="https://github.com/$REPO/releases/download/$TAG"
curl -fsSL --retry 3 "$URL/$ASSET" -o "$TMP/$ASSET"
curl -fsSL --retry 3 "$URL/SHA256SUMS" -o "$TMP/SHA256SUMS"
"$PYTHON" - "$TMP" "$ASSET" <<'PY'
import hashlib,pathlib,sys,tarfile
root=pathlib.Path(sys.argv[1]); name=sys.argv[2]
checks={p[1].lstrip('*'):p[0] for line in (root/'SHA256SUMS').read_text().splitlines() if len(p:=line.split())==2}
assert hashlib.sha256((root/name).read_bytes()).hexdigest()==checks.get(name), 'Checksum mismatch'
with tarfile.open(root/name) as tar:
    member=tar.getmember('install.py')
    assert member.isfile(), 'Invalid installer'
    (root/'install.py').write_bytes(tar.extractfile(member).read())
PY
"$PYTHON" "$TMP/install.py" "$TMP/$ASSET" "$HOME_DIR" "$BIN_DIR"
printf '\n%s\n' "Command: $BIN_DIR/cpa-usage" 'Ensure ~/.local/bin is on PATH; then run cpa-usage configure && cpa-usage start.'
