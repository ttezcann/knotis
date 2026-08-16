#!/usr/bin/env python3
from __future__ import annotations

import signal
import socket
import subprocess
import time
from pathlib import Path


def is_port_available(port: int) -> bool:
    for host in ("127.0.0.1", "::1"):
        family = socket.AF_INET6 if ":" in host else socket.AF_INET
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind((host, port))
        except OSError:
            return False
    return True


def find_available_port(preferred: int, *, exclude: set[int] | None = None) -> int:
    blocked = exclude or set()
    for port in range(preferred, preferred + 100):
        if port in blocked:
            continue
        if is_port_available(port):
            return port
    raise RuntimeError(
        f"No free localhost port found from {preferred} to {preferred + 99}"
        + (f" (excluding {sorted(blocked)})" if blocked else "")
    )


def parse_dev_addr_port(args: list[str], *, default: int = 8000) -> int | None:
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in {"--dev-addr", "-a"} and index + 1 < len(args):
            return _port_from_dev_addr(args[index + 1])
        if arg.startswith("--dev-addr="):
            return _port_from_dev_addr(arg.split("=", 1)[1])
        if arg == "--port" and index + 1 < len(args):
            return int(args[index + 1])
        if arg.startswith("--port="):
            return int(arg.split("=", 1)[1])
        index += 1
    return default if default is not None else None


def _port_from_dev_addr(value: str) -> int:
    host, _, port_text = value.rpartition(":")
    if not port_text.isdigit():
        raise ValueError(f"Invalid dev addr (expected host:port): {value!r}")
    return int(port_text)


def allocate_dev_ports(args: list[str], *, serve_default: int = 8000, preview_default: int = 8001) -> tuple[int, int]:
    requested = parse_dev_addr_port(args, default=None)
    if requested is not None:
        if not is_port_available(requested):
            raise RuntimeError(
                f"Requested dev server port {requested} is already in use. "
                "Stop the other process or choose a different --dev-addr."
            )
        serve_port = requested
    elif not is_port_available(serve_default):
        raise RuntimeError(
            f"localhost:{serve_default} is already in use by another program. "
            f"Check with lsof -i :{serve_default}, stop that process, "
            f"or pass --dev-addr localhost:PORT."
        )
    else:
        serve_port = serve_default
    preview_port = find_available_port(preview_default, exclude={serve_port})
    return serve_port, preview_port


def preview_dev_origin(serve_port: int, host: str = "localhost") -> str:
    return f"http://{host}:{serve_port}"


def listener_pids(port: int) -> list[int]:
    proc = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return []
    pids: list[int] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line.isdigit():
            pids.append(int(line))
    return pids


def process_command(pid: int) -> str:
    proc = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.stdout.strip() if proc.returncode == 0 else ""


def terminate_pid(pid: int, *, grace_seconds: float = 2.0) -> None:
    try:
        import os

        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except PermissionError:
        return

    deadline = time.time() + grace_seconds
    while time.time() < deadline:
        try:
            import os

            os.kill(pid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            return
        time.sleep(0.1)

    try:
        import os

        os.kill(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        return


def release_stale_dev_listeners(
    repo_root: Path,
    *,
    serve_port: int,
    preview_port: int = 8001,
) -> None:
    """Stop prior Knotis dev servers for this repo so serve.py can re-bind ports."""
    repo_token = str(repo_root.resolve())
    toml_token = str((repo_root / "zensical.toml").resolve())
    preview_script = str((repo_root / "scripts" / "preview_api.py").resolve())

    for pid in listener_pids(serve_port):
        command = process_command(pid)
        if "zensical" in command and (toml_token in command or repo_token in command):
            print(
                f"[serve] Stopping stale Zensical dev server on localhost:{serve_port} (pid {pid})…",
                flush=True,
            )
            terminate_pid(pid)

    for pid in listener_pids(preview_port):
        command = process_command(pid)
        if "preview_api.py" in command and (preview_script in command or repo_token in command):
            print(
                f"[serve] Stopping stale preview API on localhost:{preview_port} (pid {pid})…",
                flush=True,
            )
            terminate_pid(pid)
