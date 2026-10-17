"""S3 SDK contract tests with moto's S3 service implementation."""

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor

import pytest


@pytest.fixture
def store(tmp_path, monkeypatch):
    boto3 = pytest.importorskip("boto3")
    moto = pytest.importorskip("moto")
    from cairn.backend.storage.blobs import open_blob_store

    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.delenv("CAIRN_S3_ENDPOINT_URL", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    with moto.mock_aws():
        boto3.client("s3").create_bucket(Bucket="cairn-tests")
        yield open_blob_store("s3://cairn-tests/prefix", cache_dir=tmp_path)


def test_roundtrip_and_cold_verified_download(store):
    data = b"large data" * 100000
    digest, size = store.put(data)
    assert (digest, size) == (hashlib.sha256(data).hexdigest(), len(data))
    assert store.exists(digest) and store.size(digest) == size
    store.cache.delete(digest)
    assert store.path_for(digest).read_bytes() == data
    assert list(store.iter_digests()) == [digest]
    with store.open_stream(digest) as stream:
        assert stream.read() == data


def test_corrupt_cache_is_repaired_from_remote(store):
    digest, _ = store.put(b"correct")
    store.cache.path_for(digest).write_bytes(b"corrupt")
    assert store.get(digest) == b"correct"


def test_remote_corruption_is_detected_even_with_warm_cache(store):
    digest, _ = store.put(b"correct")
    store.client.put_object(
        Bucket=store.bucket, Key=store._key(digest), Body=b"corrupt"
    )
    assert store.verify(digest) is False
    with pytest.raises(OSError, match="checksum"):
        store.get(digest)


def test_streamed_upload_and_hash_rejection(store):
    digest = hashlib.sha256(b"uploaded").hexdigest()
    for expected in (True, False):
        incoming = store.incoming()
        with incoming:
            incoming.write(b"uploaded")
            incoming.flush()
            os.fsync(incoming.fileno())
        assert store.commit_incoming(incoming.name, digest) is expected
        assert not os.path.exists(incoming.name)
    assert store.get(digest) == b"uploaded"
    incoming = store.incoming()
    with incoming:
        incoming.write(b"wrong")
    try:
        with pytest.raises(ValueError, match="digest"):
            store.commit_incoming(incoming.name, "0" * 64)
        assert not store.exists("0" * 64)
    finally:
        os.unlink(incoming.name)


def test_concurrent_idempotent_puts_and_explicit_delete(store):
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(store.put, [b"same"] * 20))
    assert len(set(results)) == 1
    digest = results[0][0]
    assert store.delete_if_older(digest, float("inf")) is None
    assert store.exists(digest)
    store.delete(digest)
    assert not store.exists(digest)
    with pytest.raises(FileNotFoundError):
        store.get(digest)


def test_s3_access_denied_is_not_treated_as_missing(store, monkeypatch):
    from botocore.exceptions import ClientError

    def denied(**kwargs):
        raise ClientError({"Error": {"Code": "403", "Message": "Denied"}}, "HeadObject")

    monkeypatch.setattr(store.client, "head_object", denied)
    with pytest.raises(ClientError):
        store.exists("a" * 64)
