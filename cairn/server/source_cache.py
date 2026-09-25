"""An LRU of decompressed source trees.

A run's source is one ``tree.tar.zst``; reading a single file means
decompressing the whole archive. A code viewer or diff reads many files from
the same few runs, so the decompressed tree is kept, keyed by
``(archive path, mtime)``: the path is ``sources/<run_id>/tree.tar.zst`` (so
this is the run id, but unique across repos served by one process), and the
mtime means a re-uploaded archive is never served stale.
The cache is bounded by the total size of the file contents it holds.
"""

from __future__ import annotations

import io
import tarfile
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import zstandard as zstd

DEFAULT_MAX_BYTES = 128 * 1024 * 1024


@dataclass(frozen=True)
class SourceTree:
    """A decompressed archive: regular files' bytes, plus the names of every
    other member (directories, links) so a lookup can tell "not a file" from
    "not in the archive"."""

    files: dict[str, bytes]
    others: frozenset[str]
    size: int


def load_tree(archive_path: Path) -> SourceTree:
    """Decompress and unpack one ``tree.tar.zst``."""
    with archive_path.open("rb") as fh:
        raw = zstd.ZstdDecompressor().stream_reader(fh).read()
    files: dict[str, bytes] = {}
    others: set[str] = set()
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r") as tf:
        for member in tf.getmembers():
            if member.isfile():
                extracted = tf.extractfile(member)
                files[member.name] = extracted.read() if extracted is not None else b""
            else:
                others.add(member.name)
    return SourceTree(files, frozenset(others), sum(len(b) for b in files.values()))


class SourceCache:
    """Thread-safe LRU of ``SourceTree``s, bounded by ``max_bytes``.

    One lock covers lookup and load, so concurrent readers of the same run
    decompress it once. A tree larger than the whole budget is returned but
    not kept.
    """

    def __init__(self, max_bytes: int = DEFAULT_MAX_BYTES):
        self.max_bytes = max_bytes
        self._lock = threading.Lock()
        self._trees: OrderedDict[tuple[str, int], SourceTree] = OrderedDict()
        self._bytes = 0

    def get(self, archive_path: Path) -> SourceTree:
        """The tree in ``archive_path``; raises ``FileNotFoundError`` if absent."""
        path = str(archive_path.resolve())
        key = (path, archive_path.stat().st_mtime_ns)
        with self._lock:
            tree = self._trees.get(key)
            if tree is not None:
                self._trees.move_to_end(key)
                return tree
            tree = load_tree(archive_path)
            # An older archive at the same path is dead weight now.
            for stale in [k for k in self._trees if k[0] == path]:
                self._bytes -= self._trees.pop(stale).size
            if tree.size <= self.max_bytes:
                self._trees[key] = tree
                self._bytes += tree.size
                while self._bytes > self.max_bytes:
                    _, evicted = self._trees.popitem(last=False)
                    self._bytes -= evicted.size
            return tree

    def clear(self) -> None:
        with self._lock:
            self._trees.clear()
            self._bytes = 0


#: The process-wide cache ``routes/source.py`` reads through. Shared by every
#: app in the process (``cairn server --ui`` runs two on one repo).
SOURCE_CACHE = SourceCache()
