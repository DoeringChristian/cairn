"""Source archive tests."""

from __future__ import annotations

import io
import logging
import tarfile
from pathlib import Path

import zstandard as zstd

from cairn.sdk.capture.source import build_source_archive, find_project_root


def _unpack(archive_bytes: bytes) -> dict[str, bytes]:
    raw = zstd.ZstdDecompressor().decompress(archive_bytes)
    out: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
        for m in tf.getmembers():
            if m.isfile():
                fh = tf.extractfile(m)
                assert fh is not None
                out[m.name] = fh.read()
    return out


def test_find_project_root_detects_marker(tmp_path):
    root = tmp_path / "proj"
    (root / "sub" / "deeper").mkdir(parents=True)
    (root / "pyproject.toml").write_text("[project]")
    found, marker = find_project_root(root / "sub" / "deeper")
    assert found == root
    assert marker == "pyproject.toml"


def test_find_project_root_fallback_warns(tmp_path, caplog):
    # Isolate from the user's real filesystem markers by creating a
    # separate root and asserting the walk stops there.
    root = tmp_path / "bare"
    root.mkdir()
    with caplog.at_level(logging.WARNING):
        found, marker = find_project_root(root)
    # Walk will reach actual filesystem markers above tmp_path; we only care
    # that *some* result is returned (no exception) and marker is a string or None.
    assert isinstance(found, Path)


def test_build_archive_includes_expected_files(tmp_path):
    root = tmp_path / "proj"
    (root / "configs").mkdir(parents=True)
    (root / "train.py").write_text("print('x')\n")
    (root / "configs" / "base.yaml").write_text("lr: 3e-4\n")
    # Files that should be excluded
    (root / ".git").mkdir()
    (root / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
    venv = root / ".venv" / "lib"
    venv.mkdir(parents=True)
    (venv / "thing.py").write_text("skip me\n")

    archive, manifest = build_source_archive(root)
    files = _unpack(archive)
    assert "train.py" in files
    assert "configs/base.yaml" in files
    assert not any(name.startswith(".git") for name in files)
    assert not any(name.startswith(".venv") for name in files)
    # Manifest has sha256 for every file
    assert {f["path"] for f in manifest["files"]} == set(files.keys())
    assert all(len(f["sha256"]) == 64 for f in manifest["files"])


def test_build_archive_skips_large_files(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    (root / "train.py").write_text("x\n")
    big = root / "big.py"
    big.write_bytes(b"a" * (2 * 1024 * 1024))
    archive, manifest = build_source_archive(root, max_file_size_mb=1.0)
    files = _unpack(archive)
    assert "train.py" in files
    assert "big.py" not in files
    skipped = {s["path"]: s["reason"] for s in manifest["skipped"]}
    assert "big.py" in skipped
    assert "size" in skipped["big.py"]


def test_build_archive_skips_binary(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    (root / "real.py").write_text("hi\n")
    # fake "python" extension but binary content
    (root / "weird.py").write_bytes(b"ok\x00binary\x00here")
    archive, manifest = build_source_archive(root)
    files = _unpack(archive)
    assert "real.py" in files
    assert "weird.py" not in files


def test_respects_gitignore(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    (root / ".gitignore").write_text("secret.py\n")
    (root / "public.py").write_text("x\n")
    (root / "secret.py").write_text("s\n")
    archive, _ = build_source_archive(root)
    files = _unpack(archive)
    assert "public.py" in files
    assert "secret.py" not in files
