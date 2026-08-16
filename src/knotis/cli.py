from __future__ import annotations

import argparse
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import emit_dev_heartbeat
from .build_site import (
    clean_generated_page_routes,
    clean_search_index,
    normalize_generated_page_front_matter,
    resolve_zensical_config_path,
    run_zensical_build,
    stamp_knotis_asset_cache_busters,
    sync_site_runtime_assets,
    sync_source_styles,
    zensical_env,
)
from .builder import run_build
from .builder.assets_mirror import site_runtime_assets_dir
from .dev_ports import allocate_dev_ports, parse_dev_addr_port, preview_dev_origin, release_stale_dev_listeners
from .new import run_knotis_new
from .zensical_runtime import resolve_zensical_command

KNOTIS_SERVE_FLAGS = frozenset({"--no-reload", "--no-watch"})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="knotis",
        description="Knotis site build and local dev server.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser(
        "build",
        help="Build Knotis assets and the static site (wikilinks, graph, search, site/).",
    )
    build_parser.add_argument(
        "zensical_args",
        nargs=argparse.REMAINDER,
        help="Extra args forwarded to zensical build.",
    )

    new_parser = subparsers.add_parser(
        "new",
        help="Create a new Knotis site in DIRECTORY (default: current directory).",
    )
    new_parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Target directory (default: ., like zensical new).",
    )
    new_parser.add_argument(
        "--no-build",
        action="store_true",
        help="Skip the initial knotis build after scaffolding.",
    )

    serve_parser = subparsers.add_parser(
        "serve",
        help="Full rebuild, then zensical serve on localhost:8000 with Knotis watch.",
    )
    serve_parser.add_argument(
        "--no-reload",
        action="store_true",
        help="Rebuild on save but do not auto-reload the browser (default: reload on).",
    )
    serve_parser.add_argument(
        "--no-watch",
        action="store_true",
        help="Skip the Knotis file watcher (zensical serve only).",
    )
    serve_parser.add_argument(
        "zensical_args",
        nargs=argparse.REMAINDER,
        help="Extra args forwarded to zensical serve (e.g. --dev-addr localhost:8000).",
    )

    return parser


def _clean_forwarded_args(args: list[str]) -> list[str]:
    return args[1:] if args and args[0] == "--" else args


def split_serve_args(argv: list[str]) -> tuple[bool, bool, list[str]]:
    live_reload = True
    watch = True
    forwarded: list[str] = []
    for arg in argv:
        if arg == "--no-reload":
            live_reload = False
        elif arg == "--no-watch":
            watch = False
        elif arg == "--":
            pass
        elif arg in KNOTIS_SERVE_FLAGS:
            pass
        else:
            forwarded.append(arg)
    return live_reload, watch, forwarded


def run_knotis_build(site_root: Path, zensical_args: list[str] | None = None) -> int:
    print("[knotis] Building Knotis assets and site...", flush=True)
    run_build(site_root)
    result = run_zensical_build(site_root, _clean_forwarded_args(list(zensical_args or [])))
    if result != 0:
        return result
    normalize_generated_page_front_matter(site_root)
    clean_generated_page_routes(site_root)
    sync_source_styles(site_root)
    clean_search_index(site_root / "site", site_root)
    print("[knotis] Build complete.", flush=True)
    return 0


def terminate_process(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.terminate()


def kill_process(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.kill()


def served_runtime_assets_ready(site_root: Path, dev_origin: str, *, timeout: float = 10.0) -> bool:
    """Wait until Zensical serve is returning Knotis JS, not an HTML fallback."""
    deadline = time.time() + timeout
    asset_path = site_runtime_assets_dir(site_root).relative_to(site_root / "site").as_posix()
    asset_url = f"{dev_origin.rstrip('/')}/{asset_path}/knotis-core.js"
    while time.time() < deadline:
        sync_site_runtime_assets(site_root)
        clean_search_index(site_root / "site", site_root)
        stamp_knotis_asset_cache_busters(site_root / "site", site_runtime_assets_dir(site_root))
        try:
            request = urllib.request.Request(
                f"{asset_url}?knotis_ready={time.time_ns()}",
                headers={"Cache-Control": "no-cache"},
            )
            with urllib.request.urlopen(request, timeout=0.5) as response:
                body = response.read(80).lstrip()
                content_type = response.headers.get("content-type", "")
            if "javascript" in content_type and not body.startswith(b"<"):
                return True
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.1)
    return False


def run_knotis_serve(site_root: Path, argv: list[str] | None = None) -> int:
    argv = list(argv or [])
    live_reload, watch, forwarded_args = split_serve_args(_clean_forwarded_args(argv))

    rc = run_knotis_build(site_root)
    if rc != 0:
        return rc
    if live_reload:
        emit_dev_heartbeat.emit(site_root)

    env = zensical_env(site_root)
    if not live_reload:
        env["KNOTIS_NO_RELOAD"] = "1"

    serve_port_hint = parse_dev_addr_port(forwarded_args, default=8000)
    release_stale_dev_listeners(site_root, serve_port=serve_port_hint, preview_port=8001)
    serve_port, _preview_port = allocate_dev_ports(forwarded_args)
    dev_origin = preview_dev_origin(serve_port)
    preview_env = {**env, "KNOTIS_PREVIEW_DEV_URL": dev_origin}

    if not any(
        arg in {"--dev-addr", "-a"} or arg.startswith("--dev-addr=") for arg in forwarded_args
    ):
        forwarded_args.extend(["--dev-addr", f"localhost:{serve_port}"])

    serve_args = [
        *resolve_zensical_command(),
        "serve",
        "-f",
        str(resolve_zensical_config_path(site_root)),
        *forwarded_args,
    ]

    reload_note = "live reload on" if live_reload else "live reload off (--no-reload)"
    if not watch:
        print("[knotis] Starting zensical serve...", flush=True)
        serve_proc = subprocess.Popen(serve_args, env=preview_env)
        if served_runtime_assets_ready(site_root, dev_origin):
            print(f"[knotis] Site server:  {dev_origin}/", flush=True)
        else:
            print(
                f"[knotis] Site server:  {dev_origin}/ (runtime assets not confirmed)",
                flush=True,
            )
        try:
            return serve_proc.wait()
        except KeyboardInterrupt:
            print("\n[knotis] Stopping...", flush=True)
            terminate_process(serve_proc)
            deadline = time.time() + 5
            while time.time() < deadline and serve_proc.poll() is None:
                time.sleep(0.1)
            kill_process(serve_proc)
            return 130

    print(f"[knotis] Starting zensical serve and Knotis watcher ({reload_note})...", flush=True)
    serve_proc = subprocess.Popen(serve_args, env=preview_env)
    watch_proc = subprocess.Popen(
        [sys.executable, "-B", "-c", _WATCH_ENTRYPOINT, str(site_root)],
        env=preview_env,
    )
    procs = [serve_proc, watch_proc]
    if served_runtime_assets_ready(site_root, dev_origin):
        print(f"[knotis] Site server:  {dev_origin}/", flush=True)
    else:
        print(
            f"[knotis] Site server:  {dev_origin}/ (runtime assets not confirmed)",
            flush=True,
        )

    try:
        while True:
            for proc, label in ((serve_proc, "serve"), (watch_proc, "watch")):
                rc = proc.poll()
                if rc is not None:
                    print(
                        f"[knotis] {label} exited with code {rc}; stopping the other process...",
                        flush=True,
                    )
                    for other in procs:
                        if other is not proc:
                            terminate_process(other)
                    deadline = time.time() + 5
                    while time.time() < deadline and any(p.poll() is None for p in procs):
                        time.sleep(0.1)
                    for other in procs:
                        kill_process(other)
                    return rc
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[knotis] Stopping...", flush=True)
        for proc in procs:
            terminate_process(proc)
        deadline = time.time() + 5
        while time.time() < deadline and any(p.poll() is None for p in procs):
            time.sleep(0.1)
        for proc in procs:
            kill_process(proc)
        return 130


_WATCH_ENTRYPOINT = """
from pathlib import Path
import sys
from knotis.watch import watch
watch(Path(sys.argv[1]), skip_initial_build=True)
"""


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "new":
            run_knotis_new(Path(args.directory), run_build=not args.no_build)
            return 0
        if args.command == "build":
            return run_knotis_build(Path.cwd(), args.zensical_args)
        if args.command == "serve":
            serve_argv: list[str] = []
            if args.no_reload:
                serve_argv.append("--no-reload")
            if args.no_watch:
                serve_argv.append("--no-watch")
            serve_argv.extend(args.zensical_args)
            return run_knotis_serve(Path.cwd(), serve_argv)
    except (subprocess.CalledProcessError, FileExistsError, FileNotFoundError, RuntimeError) as exc:
        if isinstance(exc, subprocess.CalledProcessError):
            return exc.returncode
        print(f"[knotis] {exc}", file=sys.stderr)
        return 1

    parser.error(f"unknown command: {args.command}")
    return 2
