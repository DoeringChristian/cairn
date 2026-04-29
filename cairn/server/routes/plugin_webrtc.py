"""WebRTC video streaming for WindowPlugin.

Provides an `XvfbVideoTrack` that captures frames from an Xvfb virtual
display via mss and streams them as a WebRTC video track using aiortc.

The WebSocket connection handles:
- WebRTC signaling (offer/answer/ICE candidates)
- Mouse/keyboard input events
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


class XvfbVideoTrack(VideoStreamTrack):
    """VideoStreamTrack that captures from an Xvfb session via mss."""

    kind = "video"

    def __init__(self, xvfb_session: Any, fps: int = 30):
        super().__init__()
        self._xvfb = xvfb_session
        self._fps = fps

    async def recv(self):
        # Pace to target FPS first, then capture.
        await asyncio.sleep(1.0 / self._fps)

        pts, time_base = await self.next_timestamp()

        # Capture frame in a thread to avoid blocking the event loop.
        loop = asyncio.get_event_loop()
        arr = await loop.run_in_executor(None, self._capture_frame)

        frame = VideoFrame.from_ndarray(arr, format="rgb24")
        frame.pts = pts
        frame.time_base = time_base
        return frame

    def _capture_frame(self) -> np.ndarray:
        """Capture a frame synchronously (runs in thread executor)."""
        # Fast path: mss shared memory.
        rgb, w, h = self._xvfb.screenshot_raw()
        if rgb and w > 0 and h > 0:
            return np.frombuffer(rgb, dtype=np.uint8).reshape(h, w, 3).copy()

        # Slow fallback: subprocess screenshot → decode.
        try:
            jpeg_bytes = self._xvfb.screenshot()
            from PIL import Image as _Img
            import io as _io
            img = _Img.open(_io.BytesIO(jpeg_bytes)).convert("RGB")
            return np.array(img, dtype=np.uint8)
        except Exception:
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
