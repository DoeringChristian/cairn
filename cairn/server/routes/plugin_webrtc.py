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
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRelay
from av import VideoFrame
from aiortc.mediastreams import VideoStreamTrack

log = logging.getLogger(__name__)


class XvfbVideoTrack(VideoStreamTrack):
    """VideoStreamTrack that captures from an Xvfb session via mss."""

    kind = "video"

    def __init__(self, xvfb_session: Any, fps: int = 30):
        super().__init__()
        self._xvfb = xvfb_session
        self._fps = fps

    async def recv(self) -> VideoFrame:
        pts, time_base = await self.next_timestamp()

        # Capture frame from Xvfb.
        rgb, w, h = self._xvfb.screenshot_raw()
        if not rgb or w <= 0 or h <= 0:
            # Return a black frame if capture fails.
            w, h = self._xvfb.width, self._xvfb.height
            arr = np.zeros((h, w, 3), dtype=np.uint8)
        else:
            arr = np.frombuffer(rgb, dtype=np.uint8).reshape(h, w, 3)

        frame = VideoFrame.from_ndarray(arr, format="rgb24")
        frame.pts = pts
        frame.time_base = time_base

        # Pace to target FPS.
        await asyncio.sleep(1.0 / self._fps)
        return frame


async def setup_webrtc(
    xvfb_session: Any,
    fps: int = 30,
) -> tuple[RTCPeerConnection, XvfbVideoTrack]:
    """Create an RTCPeerConnection with an Xvfb video track."""
    pc = RTCPeerConnection()
    track = XvfbVideoTrack(xvfb_session, fps=fps)
    pc.addTrack(track)
    return pc, track


async def handle_webrtc_offer(
    pc: RTCPeerConnection,
    offer_sdp: str,
) -> str:
    """Process a WebRTC offer and return the answer SDP."""
    offer = RTCSessionDescription(sdp=offer_sdp, type="offer")
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    return pc.localDescription.sdp


async def cleanup_webrtc(pc: RTCPeerConnection | None) -> None:
    """Close the peer connection."""
    if pc is not None:
        await pc.close()
