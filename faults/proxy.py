"""A small TCP proxy the fault runner controls (in-process, own thread).

``FaultProxy(listen_port, upstream_port)``:
  * ``down()``  — reset every open connection and refuse new ones (RST): the
    server is unreachable, as during a network partition or a host reboot;
  * ``down("blackhole")`` — a partition: connections (open and new) are
    accepted but nothing is forwarded or answered, so clients wait for their
    timeouts; ``up()`` resets the stalled connections;
  * ``up()``    — accept again;
  * ``latency`` — seconds added before forwarding each chunk, both directions
    (a slow link / overloaded server).
"""

from __future__ import annotations

import asyncio
import socket
import struct
import threading


class FaultProxy:
    def __init__(self, listen_port: int, upstream_port: int, host: str = "127.0.0.1") -> None:
        self.listen_port, self.upstream_port, self.host = listen_port, upstream_port, host
        self.latency = 0.0
        self._down = False
        self._blackhole = False
        self._writers: set[asyncio.StreamWriter] = set()
        self._loop = asyncio.new_event_loop()
        self._server: asyncio.base_events.Server | None = None
        self._ready = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()
        self._ready.wait(10)

    # ---- control (any thread)

    def down(self, mode: str = "reset") -> None:
        if mode == "blackhole":
            self._blackhole = True
            return
        self._down = True
        asyncio.run_coroutine_threadsafe(self._reset_all(), self._loop).result(10)

    def up(self) -> None:
        if self._blackhole:
            asyncio.run_coroutine_threadsafe(self._reset_all(), self._loop).result(10)
        self._down = False
        self._blackhole = False

    def close(self) -> None:
        self._down = True
        asyncio.run_coroutine_threadsafe(self._shutdown(), self._loop).result(10)
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._t.join(10)

    # ---- loop

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._server = self._loop.run_until_complete(
            asyncio.start_server(self._handle, self.host, self.listen_port, reuse_address=True))
        self._ready.set()
        self._loop.run_forever()

    async def _shutdown(self) -> None:
        await self._reset_all()
        if self._server:
            self._server.close()

    @staticmethod
    def _rst(w: asyncio.StreamWriter) -> None:
        sock = w.get_extra_info("socket")
        try:
            if sock is not None:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
        except OSError:
            pass
        w.close()

    async def _reset_all(self) -> None:
        for w in list(self._writers):
            self._rst(w)
        self._writers.clear()

    async def _handle(self, cr: asyncio.StreamReader, cw: asyncio.StreamWriter) -> None:
        if self._down:
            self._rst(cw)
            return
        if self._blackhole:
            self._writers.add(cw)
            try:
                while await cr.read(65536):
                    pass
            except (ConnectionError, OSError):
                pass
            self._writers.discard(cw)
            return
        try:
            ur, uw = await asyncio.open_connection(self.host, self.upstream_port)
        except OSError:
            self._rst(cw)
            return
        self._writers.update((cw, uw))

        async def pipe(r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
            try:
                while True:
                    data = await r.read(65536)
                    if not data or self._down:
                        break
                    while self._blackhole and not self._down:
                        await asyncio.sleep(0.05)  # hold it: nothing gets through
                    if self._down:
                        break
                    if self.latency:
                        await asyncio.sleep(self.latency)
                    w.write(data)
                    await w.drain()
            except (ConnectionError, OSError, asyncio.CancelledError):
                pass
            finally:
                if self._down:
                    self._rst(w)
                else:
                    try:
                        w.close()
                    except Exception:  # noqa: BLE001
                        pass

        await asyncio.gather(pipe(cr, uw), pipe(ur, cw))
        self._writers.discard(cw)
        self._writers.discard(uw)
