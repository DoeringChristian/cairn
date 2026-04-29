"""WebRTC video streaming for WindowPlugin.

Provides an `XvfbVideoTrack` that captures frames from an Xvfb virtual
display via mss and streams them as a WebRTC video track using aiortc.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import numpy as np

try:
    from aiortc import RTCPeerConnection, RTCSessionDescription
    from aiortc.mediastreams import VideoStreamTrack
    from av import VideoFrame
    HAS_AIORTC = True
except ImportError:
    HAS_AIORTC = False
    RTCPeerConnection = None  # type: ignore
    VideoStreamTrack = object  # type: ignore

log = logging.getLogger(__name__)

# Increase VP8 default bitrate from 900kbps to 8Mbps for local streaming.
try:
    from aiortc.codecs import vpx
    vpx.DEFAULT_BITRATE = 8_000_000  # 8 Mbps
except (ImportError, AttributeError):
    pass


class XvfbVideoTrack(VideoStreamTrack):
    """VideoStreamTrack that captures from an Xvfb session via mss."""

    kind = "video"

    def __init__(self, xvfb_session: Any, fps: int = 30):
        super().__init__()
        self._xvfb = xvfb_session
        self._fps = fps
        self._frame_count = 0

    async def recv(self):
        try:
            pts, time_base = await self.next_timestamp()

            # Capture frame in a thread to avoid blocking the event loop.
            loop = asyncio.get_event_loop()
            arr = await loop.run_in_executor(None, self._capture_frame)

            frame = VideoFrame.from_ndarray(arr, format="rgb24")
            frame.pts = pts
            frame.time_base = time_base
            self._frame_count += 1
            if self._frame_count <= 3 or self._frame_count % 300 == 0:
                print(f"[webrtc] Frame #{self._frame_count}: {arr.shape}", flush=True)
            return frame
        except Exception as e:
            print(f"[webrtc] recv() error: {e}", flush=True)
            import traceback; traceback.print_exc()
            raise

    def _capture_frame(self) -> np.ndarray:
        """Capture a frame synchronously (runs in thread executor)."""
        try:
            rgb, w, h = self._xvfb.screenshot_raw()
            if rgb and w > 0 and h > 0:
                arr = np.frombuffer(rgb, dtype=np.uint8).reshape(h, w, 3).copy()
                nonzero = np.count_nonzero(arr)
            if self._frame_count < 5:
                print(f"[webrtc] mss capture: {w}x{h}, nonzero={nonzero}/{arr.size}", flush=True)
            if nonzero == 0 and self._frame_count > 10:
                # Persistent black frames — app can't render on Xvfb.
                try:
                    from PIL import Image as _Img, ImageDraw as _Draw
                    img = _Img.fromarray(arr)
                    draw = _Draw.Draw(img)
                    draw.text((10, 10), "App window is black - may need VirtualGL", fill=(255, 80, 80))
                    draw.text((10, 30), "Install: apt install virtualgl", fill=(180, 180, 180))
                    return np.array(img, dtype=np.uint8)
                except Exception:
                    pass
            return arr
        except Exception as e:
            print(f"[webrtc] mss capture failed: {e}", flush=True)

        try:
            jpeg_bytes = self._xvfb.screenshot()
            from PIL import Image as _Img
            import io as _io
            img = _Img.open(_io.BytesIO(jpeg_bytes)).convert("RGB")
            arr = np.array(img, dtype=np.uint8)
            if self._frame_count < 5:
                print(f"[webrtc] JPEG fallback: {arr.shape}, size={len(jpeg_bytes)}", flush=True)
            return arr
        except Exception as e:
            print(f"[webrtc] JPEG capture also failed: {e}", flush=True)

        print(f"[webrtc] Returning black frame", flush=True)
        return np.zeros((self._xvfb.height, self._xvfb.width, 3), dtype=np.uint8)


async def setup_webrtc(
    xvfb_session: Any,
    fps: int = 30,
) -> tuple:
    """Create an RTCPeerConnection with an Xvfb video track."""
    if not HAS_AIORTC:
        raise ImportError(
            "aiortc is required for WebRTC streaming. "
            "Install with: pip install cairn-track[plugins]"
        )
    pc = RTCPeerConnection()
    track = XvfbVideoTrack(xvfb_session, fps=fps)
    pc.addTrack(track)
    return pc, track


async def handle_webrtc_offer(
    pc: RTCPeerConnection,
    offer_sdp: str,
) -> str:
    """Process a WebRTC offer and return the answer SDP with ICE candidates."""
    offer = RTCSessionDescription(sdp=offer_sdp, type="offer")
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    # Wait for ICE gathering to complete so candidates are in the SDP.
    if pc.iceGatheringState != "complete":
        gathering_done = asyncio.Event()

        @pc.on("icegatheringstatechange")
        def on_ice_gathering():
            if pc.iceGatheringState == "complete":
                gathering_done.set()

        try:
            await asyncio.wait_for(gathering_done.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            log.warning("ICE gathering timed out, sending partial SDP")

    return pc.localDescription.sdp


async def cleanup_webrtc(pc: RTCPeerConnection | None) -> None:
    """Close the peer connection."""
    if pc is not None:
        await pc.close()
