"""Opt-in verified build-output reuse; execution is fresh unless requested."""
import json
import errno
import os
from pathlib import Path
import shutil
import tempfile
from .engine import _file_hash, _hash, _json


def implementation_hash():
    root = Path(__file__).parent
    return _hash(_json({p.relative_to(root).as_posix():_file_hash(p)
        for p in sorted(root.rglob('*')) if p.is_file() and p.suffix in {'.py','.css','.js','.html'}}))


def _root(config):
    return Path(os.environ.get('CAIRN_REPORT_CACHE', str(config.cairn_dir/'report-cache')))


def _files(folder):
    return {p.relative_to(folder).as_posix():_file_hash(p) for p in sorted(folder.rglob('*')) if p.is_file()}


def restore(config, key, output):
    folder = _root(config)/key
    try:
        manifest = json.loads((folder/'files.json').read_text())
        if manifest != _files(folder/'outputs'):
            return False
        shutil.copytree(folder/'outputs', output)
        return True
    except (OSError, ValueError):
        return False


def save(config, key, output):
    root = _root(config)
    root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.cache-',dir=root))
    try:
        shutil.copytree(output, stage/'outputs')
        (stage/'files.json').write_text(_json(_files(stage/'outputs')))
        try:
            stage.rename(root/key)
        except OSError as exc:
            if exc.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                raise
    finally:
        shutil.rmtree(stage,ignore_errors=True)
