"""The run log's record frame: round trip, checksums, torn tails, headers."""

from __future__ import annotations

import zlib

import pytest

from cairn.sdk.runlog import codec
from cairn.sdk.runlog.log import scan, segment_name


def _records(n: int) -> list[dict]:
    return [codec.make_record(i + 1, "batch", 1.5, {"run_id": "r", "points": [{"v": i, "s": "x" * i}]})
            for i in range(n)]


def _segment(records: list[dict], kind: int = codec.CRC32C) -> bytes:
    return codec.header(kind) + b"".join(
        codec.encode_frame(codec.encode_payload(r), kind) for r in records)


@pytest.mark.parametrize("kind", [codec.CRC32C, codec.CRC32])
def test_round_trip(kind: int) -> None:
    recs = _records(20)
    data = _segment(recs, kind)
    assert codec.parse_header(data[:8]) == kind
    frames, end, problem = codec.decode_frames(data, kind, codec.HEADER_LEN)
    assert problem is None and end == len(data)
    assert [codec.decode_payload(p) for _e, p in frames] == recs


def test_nan_and_unicode_survive() -> None:
    rec = codec.make_record(1, "params", 0.0, {"params": {"x": float("inf"), "name": "Grüße ✓"}})
    data = _segment([rec])
    frames, _, _ = codec.decode_frames(data, codec.CRC32C, 8)
    out = codec.decode_payload(frames[0][1])
    assert out["params"]["x"] == float("inf") and out["params"]["name"] == "Grüße ✓"


def test_reserved_keys_refused() -> None:
    with pytest.raises(ValueError, match="reserved"):
        codec.make_record(1, "x", 0.0, {"seq": 3})


def test_crc32c_matches_reference() -> None:
    # The standard check value of CRC-32C.
    assert codec.crc32c_py(b"123456789") == 0xE3069283
    assert codec.crc_function(codec.CRC32C)(b"123456789") == 0xE3069283
    assert codec.crc_function(codec.CRC32)(b"abc") == zlib.crc32(b"abc")


@pytest.mark.parametrize("where", ["len", "len_crc", "payload", "payload_crc"])
def test_checksum_mismatch_stops_decoding(where: str) -> None:
    recs = _records(5)
    data = bytearray(_segment(recs))
    # Damage the third frame.
    frames, _, _ = codec.decode_frames(bytes(data), codec.CRC32C, 8)
    start = frames[1][0]
    n = len(frames[2][1])
    offset = {"len": start, "len_crc": start + 9, "payload": start + 14,
              "payload_crc": start + 12 + n + 1}[where]
    data[offset] ^= 0x40
    got, end, problem = codec.decode_frames(bytes(data), codec.CRC32C, 8)
    assert [codec.decode_payload(p)["seq"] for _e, p in got] == [1, 2]
    assert end == start and problem is not None and problem != codec.TRUNCATED


def test_implausible_length_is_damage() -> None:
    import struct

    n = struct.pack("<Q", codec.MAX_RECORD + 1)
    data = n + struct.pack("<I", codec.crc_function(codec.CRC32C)(n)) + b"x" * 10
    _, end, problem = codec.decode_frames(data, codec.CRC32C)
    assert end == 0 and "implausible" in problem


def test_torn_tail_at_every_byte_offset(tmp_path) -> None:
    """A log cut at any byte keeps exactly the records that end before the cut."""
    recs = _records(6)
    data = _segment(recs)
    frames, _, _ = codec.decode_frames(data, codec.CRC32C, 8)
    ends = [e for e, _p in frames]
    log_dir = tmp_path / "log"
    log_dir.mkdir()
    seg = log_dir / segment_name(0)
    for cut in range(len(data) + 1):
        seg.write_bytes(data[:cut])
        res = scan(log_dir)
        assert res.error is None, cut
        want = sum(1 for e in ends if e <= cut)
        assert [r["seq"] for r in res.records] == list(range(1, want + 1)), cut
        if cut >= codec.HEADER_LEN:
            assert res.torn == (cut not in (codec.HEADER_LEN, *ends)), cut


def test_bad_magic_and_version() -> None:
    with pytest.raises(codec.CorruptRecord, match="magic"):
        codec.parse_header(b"NOTALOG\x01")
    with pytest.raises(codec.CorruptRecord, match="unknown"):
        codec.parse_header(codec.MAGIC + b"\x09")
    with pytest.raises(codec.CorruptRecord):
        codec.parse_header(b"CAIR")


def test_damage_before_the_last_segment_is_an_error(tmp_path) -> None:
    log_dir = tmp_path / "log"
    log_dir.mkdir()
    a = bytearray(_segment(_records(3)))
    a[-2] ^= 1  # last frame of the FIRST segment
    (log_dir / segment_name(0)).write_bytes(bytes(a))
    (log_dir / segment_name(1)).write_bytes(_segment([codec.make_record(4, "x", 0, {})]))
    res = scan(log_dir)
    assert res.error is not None and res.last_seq == 2


def test_seq_gap_is_damage(tmp_path) -> None:
    log_dir = tmp_path / "log"
    log_dir.mkdir()
    recs = _records(3)
    recs[2]["seq"] = 7
    (log_dir / segment_name(0)).write_bytes(_segment(recs))
    res = scan(log_dir)
    assert res.last_seq == 2 and res.torn


def test_record_blobs() -> None:
    h = "a" * 64
    assert codec.record_blobs({"op": "artifact_meta", "hash": h}) == [h]
    assert codec.record_blobs({"op": "source", "hash": h}) == [h]
    assert codec.record_blobs({"op": "batch", "hash": h}) == []
