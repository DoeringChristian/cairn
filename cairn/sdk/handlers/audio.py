"""Audio handler — numpy/torch → WAV."""

from __future__ import annotations

import io
from typing import Any

import numpy as np

from ..wrappers import _TypeWrapper
from ._optional import try_import


class AudioHandler:
    object_type = "audio"
    mime_type = "audio/wav"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        if isinstance(obj, np.ndarray):
            return obj.ndim in (1, 2)
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            return obj.ndim in (1, 2)
        return False

    @staticmethod
    def _to_array(obj: Any) -> np.ndarray:
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            return obj.detach().cpu().numpy()
        if isinstance(obj, np.ndarray):
            return obj
        raise TypeError(f"Cannot coerce {type(obj)!r} to audio array")

    def serialize(
        self, obj: Any, sample_rate: int = 16000, **kwargs: Any
    ) -> tuple[bytes, dict[str, Any]]:
        arr = self._to_array(obj)
        # Normalize shape: prefer (frames,) mono or (channels, frames) for ≥2D.
        if arr.ndim == 2 and arr.shape[0] > arr.shape[1]:
            # Likely (frames, channels); transpose to (channels, frames).
            arr = arr.T
        channels = 1 if arr.ndim == 1 else arr.shape[0]

        # Normalize float audio to int16.
        if arr.dtype in (np.float32, np.float64):
            max_abs = float(np.max(np.abs(arr))) if arr.size > 0 else 1.0
            if max_abs > 1.0:
                arr = arr / max_abs
            arr_i16 = (arr * 32767.0).clip(-32768, 32767).astype(np.int16)
        elif arr.dtype == np.int16:
            arr_i16 = arr
        else:
            arr_i16 = arr.astype(np.int16)

        sf = try_import("soundfile")
        buf = io.BytesIO()
        write_arr = arr_i16 if arr_i16.ndim == 1 else arr_i16.T  # soundfile wants (frames, channels)
        if sf is not None:
            sf.write(buf, write_arr, sample_rate, format="WAV", subtype="PCM_16")
        else:
            # stdlib wave fallback
            import struct
            import wave

            with wave.open(buf, "wb") as wf:
                wf.setnchannels(channels)
                wf.setsampwidth(2)
                wf.setframerate(sample_rate)
                # Interleave channels if needed (wave expects bytes)
                if arr_i16.ndim == 1:
                    frames = arr_i16.tobytes()
                else:
                    # (channels, frames) → (frames*channels,) interleaved
                    frames = arr_i16.T.astype(np.int16).tobytes()
                wf.writeframes(frames)

        data = buf.getvalue()

        # Peaks summary for UI waveform preview (64 buckets).
        flat = arr_i16.reshape(-1)
        n_buckets = 64
        peaks: list[float] = []
        if flat.size >= n_buckets:
            split = np.array_split(flat, n_buckets)
            peaks = [float(np.max(np.abs(chunk)) / 32768.0) for chunk in split]
        else:
            peaks = [float(abs(x) / 32768.0) for x in flat]

        duration = flat.size / max(channels, 1) / sample_rate

        meta = {
            "sample_rate": sample_rate,
            "duration": duration,
            "channels": channels,
            "peaks": peaks,
            "num_samples": int(flat.size / max(channels, 1)),
        }
        return data, meta
