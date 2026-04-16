"""Audio handler — WAV round-trip."""

from __future__ import annotations

import io
import wave

import numpy as np

from cairn.sdk.handlers.audio import AudioHandler


def test_sine_wave_roundtrip():
    h = AudioHandler()
    sr = 16000
    t = np.linspace(0, 1.0, sr, endpoint=False, dtype=np.float32)
    wave_arr = 0.5 * np.sin(2 * np.pi * 440.0 * t)
    data, meta = h.serialize(wave_arr, sample_rate=sr)
    assert meta["sample_rate"] == sr
    assert abs(meta["duration"] - 1.0) < 0.01
    assert meta["channels"] == 1
    assert len(meta["peaks"]) == 64
    # Read back with stdlib wave to confirm it's valid.
    with wave.open(io.BytesIO(data), "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getframerate() == sr
        assert wf.getnframes() == sr


def test_int16_passthrough():
    h = AudioHandler()
    arr = (np.random.default_rng(0).integers(-1000, 1000, size=8000)).astype(np.int16)
    data, meta = h.serialize(arr, sample_rate=8000)
    with wave.open(io.BytesIO(data), "rb") as wf:
        assert wf.getframerate() == 8000


def test_can_handle_1d_and_2d():
    h = AudioHandler()
    assert h.can_handle(np.zeros(100))
    assert h.can_handle(np.zeros((2, 100)))
    assert not h.can_handle(np.zeros((2, 100, 3)))
