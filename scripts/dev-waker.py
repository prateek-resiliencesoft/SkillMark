#!/usr/bin/env python3
"""Wake the dev stack on the first request. Stop it when idle or when RAM is tight.

Production is protected by hard container caps in docker-compose.dev.yml and by
refusing to start (or stopping) dev when the host is low on memory.
Dev database volume is kept. Only CPU and RAM are released.
"""
from __future__ import annotations

import asyncio
import subprocess
import time

COMPOSE = [
    "docker",
    "compose",
    "-f",
    "/opt/skillmark-dev/docker-compose.dev.yml",
    "--env-file",
    "/opt/skillmark-dev/.env.dev",
    "-p",
    "skillmark-dev",
]
APP_PORT = 3100
VOICE_PORT = 8182
IDLE_SEC = 15 * 60
# Leave this much RAM free before starting dev (prod + OS).
MIN_FREE_TO_START_MB = 1400
# Force-stop dev if the host drops below this, even mid-request.
MIN_FREE_WHILE_RUNNING_MB = 700
LISTEN_PORT = 3199

op_lock = asyncio.Lock()
active = 0
last_hit = 0.0


def mem_available_mb() -> int:
    with open("/proc/meminfo", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    return 0


def log(msg: str) -> None:
    print(msg, flush=True)


def port_open(port: int) -> bool:
    import socket

    try:
        with socket.create_connection(("127.0.0.1", port), 0.3):
            return True
    except OSError:
        return False


async def run_compose(*args: str) -> bool:
    proc = await asyncio.create_subprocess_exec(
        *COMPOSE,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    out, _ = await proc.communicate()
    if proc.returncode != 0:
        text = (out or b"").decode("utf-8", "replace")[-800:]
        log(f"compose {' '.join(args)} failed: {text}")
        return False
    return True


async def backend_ready(port: int, http: bool) -> bool:
    """Docker's port proxy accepts TCP before the process listens. Wait for a real reply."""
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", port), 2)
    except Exception:
        return False
    try:
        if not http:
            await asyncio.sleep(0.3)
            return not writer.is_closing()
        writer.write(b"GET /login HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        await writer.drain()
        data = await asyncio.wait_for(reader.read(12), 3)
        return data.startswith(b"HTTP/")
    except Exception:
        return False
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def wait_backend(port: int, timeout: float, http: bool) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if await backend_ready(port, http):
            return True
        await asyncio.sleep(0.5)
    return False


async def ensure(voice: bool) -> bool:
    global last_hit
    async with op_lock:
        last_hit = time.time()
        if mem_available_mb() < MIN_FREE_TO_START_MB and not port_open(APP_PORT):
            log(f"refuse start, MemAvailable={mem_available_mb()}MB")
            return False
        if voice:
            ok = await run_compose("--profile", "voice", "up", "-d")
            if not ok:
                return False
            return await wait_backend(VOICE_PORT, 90, http=False)
        if await backend_ready(APP_PORT, http=True):
            return True
        ok = await run_compose("up", "-d")
        if not ok:
            return False
        return await wait_backend(APP_PORT, 90, http=True)


async def stop_stack(reason: str) -> None:
    async with op_lock:
        if not port_open(APP_PORT) and not port_open(VOICE_PORT):
            return
        log(f"stopping dev ({reason})")
        await run_compose("--profile", "voice", "stop")


async def idle_loop() -> None:
    while True:
        await asyncio.sleep(20)
        free = mem_available_mb()
        if free < MIN_FREE_WHILE_RUNNING_MB:
            await stop_stack(f"low memory {free}MB")
            continue
        if active > 0:
            continue
        if last_hit and time.time() - last_hit > IDLE_SEC:
            await stop_stack("idle")


async def pipe(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
    try:
        while True:
            chunk = await src.read(65536)
            if not chunk:
                break
            dst.write(chunk)
            await dst.drain()
    except Exception:
        pass
    finally:
        try:
            dst.close()
        except Exception:
            pass


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    global active, last_hit
    active += 1
    last_hit = time.time()
    try:
        try:
            header = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 15)
        except Exception:
            return
        line = header.split(b"\r\n", 1)[0].decode("latin1", "replace")
        parts = line.split(" ")
        path = parts[1] if len(parts) > 1 else "/"
        path = path.split("?", 1)[0]
        if path == "/healthz":
            body = b"waker\n"
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\nConnection: close\r\n\r\n"
                + body
            )
            await writer.drain()
            return
        voice = path.startswith("/ws/")
        if not await ensure(voice):
            body = b"Dev is paused so production keeps enough memory. Try again shortly.\n"
            writer.write(
                b"HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nContent-Length: "
                + str(len(body)).encode()
                + b"\r\nConnection: close\r\n\r\n"
                + body
            )
            await writer.drain()
            return
        host, port = ("127.0.0.1", VOICE_PORT if voice else APP_PORT)
        try:
            up_r, up_w = await asyncio.open_connection(host, port)
        except OSError:
            return
        up_w.write(header)
        await up_w.drain()
        await asyncio.gather(pipe(reader, up_w), pipe(up_r, writer))
    finally:
        active -= 1
        try:
            writer.close()
        except Exception:
            pass


def listen_hosts() -> list[str]:
    hosts = ["127.0.0.1"]
    try:
        gw = subprocess.check_output(
            [
                "docker",
                "network",
                "inspect",
                "skillmark_default",
                "-f",
                "{{(index .IPAM.Config 0).Gateway}}",
            ],
            text=True,
        ).strip()
        if gw:
            hosts.append(gw)
    except Exception as exc:
        log(f"gateway lookup failed: {exc}")
    return hosts


async def main() -> None:
    servers = []
    for host in listen_hosts():
        try:
            servers.append(await asyncio.start_server(handle, host, LISTEN_PORT))
            log(f"listening {host}:{LISTEN_PORT}")
        except OSError as exc:
            log(f"bind {host}:{LISTEN_PORT} failed: {exc}")
    if not servers:
        raise SystemExit("no listen address")
    asyncio.create_task(idle_loop())
    await asyncio.gather(*(s.serve_forever() for s in servers))


if __name__ == "__main__":
    asyncio.run(main())
