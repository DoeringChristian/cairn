"""Source archive upload + read via the API."""

from __future__ import annotations

import io
import json
import tarfile

import zstandard as zstd


def _build_archive(files: dict[str, bytes]) -> tuple[bytes, dict]:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for name, content in files.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(content)
            tf.addfile(info, io.BytesIO(content))
    raw = buf.getvalue()
    compressed = zstd.ZstdCompressor().compress(raw)
    manifest = {
        "root": "/tmp/source",
        "captured_at": "2026-04-16T00:00:00Z",
        "files": [{"path": n, "size": len(c), "sha256": "x"} for n, c in files.items()],
        "skipped": [],
        "marker": "pyproject.toml",
    }
    return compressed, manifest


def test_upload_and_read_tree(client):
    rid = client.post("/api/runs", json={"project": "p", "task": "t"}).json()["run_id"]
    archive, manifest = _build_archive(
        {"train.py": b"print('hi')\n", "config/a.yaml": b"x: 1\n"}
    )
    r = client.post(
        f"/api/runs/{rid}/source",
        files={"archive": ("tree.tar.zst", io.BytesIO(archive), "application/zstd")},
        data={"manifest": json.dumps(manifest)},
    )
    assert r.status_code == 200
    assert r.json()["num_files"] == 2

    tree = client.get(f"/api/runs/{rid}/source/tree").json()
    assert {f["path"] for f in tree["files"]} == {"train.py", "config/a.yaml"}

    one = client.get(f"/api/runs/{rid}/source/file", params={"path": "train.py"}).json()
    assert one["content"] == "print('hi')\n"
    assert one["encoding"] == "utf-8"


def test_path_traversal_rejected(client):
    rid = client.post("/api/runs", json={"project": "p", "task": "t"}).json()["run_id"]
    archive, manifest = _build_archive({"train.py": b"x\n"})
    client.post(
        f"/api/runs/{rid}/source",
        files={"archive": ("a.tar.zst", io.BytesIO(archive), "application/zstd")},
        data={"manifest": json.dumps(manifest)},
    )
    for bad in ("/etc/passwd", "../../../etc/passwd", "..\\win.ini"):
        r = client.get(f"/api/runs/{rid}/source/file", params={"path": bad})
        assert r.status_code == 400, f"expected 400 for {bad!r}, got {r.status_code}"


def test_missing_source_404s(client):
    rid = client.post("/api/runs", json={"project": "p", "task": "t"}).json()["run_id"]
    r = client.get(f"/api/runs/{rid}/source/tree")
    assert r.status_code == 404


def test_large_manifest_accepted(client):
    """Regression: Starlette's default 1 MiB per-part cap was rejecting the
    source manifest JSON for repos with lots of files. We override
    ``max_part_size`` on the /source and /artifacts handlers.
    """
    rid = client.post("/api/runs", json={"project": "p", "task": "t"}).json()["run_id"]
    # Build a manifest with enough entries to exceed 1 MiB when JSON-encoded.
    # Each entry is ~160 bytes; 10k entries → ~1.6 MB of form data.
    files = {f"pkg/file_{i:05d}.py": b"print(1)\n" for i in range(10_000)}
    archive, manifest = _build_archive({k: v for k, v in list(files.items())[:10]})
    # Swap in the big files[] list (archive can stay small — only manifest
    # size matters for the multipart-part cap).
    manifest["files"] = [
        {"path": name, "size": len(b), "sha256": "a" * 64}
        for name, b in files.items()
    ]
    manifest_json = json.dumps(manifest)
    assert len(manifest_json) > 1_000_000, "test setup: need >1 MiB manifest"
    r = client.post(
        f"/api/runs/{rid}/source",
        files={"archive": ("a.tar.zst", io.BytesIO(archive), "application/zstd")},
        data={"manifest": manifest_json},
    )
    assert r.status_code == 200, r.text
    assert r.json()["num_files"] == 10_000


def test_large_artifact_accepted(client):
    """Regression: uploading a >1 MiB artifact (e.g. a short video or tensor)
    was failing before we raised max_part_size on /artifacts.
    """
    payload = b"x" * (2 * 1024 * 1024)  # 2 MiB
    r = client.post(
        "/api/artifacts",
        files={"file": ("big.bin", io.BytesIO(payload), "application/octet-stream")},
        data={"mime_type": "application/octet-stream"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["size_bytes"] == len(payload)


def test_binary_file_returned_as_base64(client):
    rid = client.post("/api/runs", json={"project": "p", "task": "t"}).json()["run_id"]
    archive, manifest = _build_archive({"bin.dat": b"\x00\x01\xff\xfe"})
    client.post(
        f"/api/runs/{rid}/source",
        files={"archive": ("a.tar.zst", io.BytesIO(archive), "application/zstd")},
        data={"manifest": json.dumps(manifest)},
    )
    r = client.get(f"/api/runs/{rid}/source/file", params={"path": "bin.dat"}).json()
    assert r["encoding"] == "base64"
    import base64

    assert base64.b64decode(r["content"]) == b"\x00\x01\xff\xfe"
