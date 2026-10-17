"""Pinned current/uv Python environments, extracted from Prism2 without server jobs."""
from __future__ import annotations
import json, os, shutil, subprocess, sys, tempfile, threading
from pathlib import Path
from .engine import ReportError, _json, _hash
_ENV_MUTEX = threading.Lock()


def _fingerprint(python):
    code = (
        "import json,sys,platform,importlib.metadata as m;"
        "print(json.dumps({'python':platform.python_version(),"
        "'implementation':platform.python_implementation(),'platform':sys.platform,"
        "'packages':dict(sorted((d.metadata['Name'].lower().replace('_','-'),d.version)"
        " for d in m.distributions() if d.metadata['Name']))},sort_keys=True))"
    )
    result = subprocess.run(
        [str(python), "-c", code], check=True, capture_output=True, text=True, timeout=60
    )
    return json.loads(result.stdout)

def _run_uv(args, timeout=600):
    uv = shutil.which("uv")
    if not uv:
        raise ReportError("Managed report environments require uv on the worker")
    result = subprocess.run(
        [uv, *args], check=False, capture_output=True, text=True, timeout=timeout
    )
    if result.returncode:
        # Do not echo index credentials or all subprocess environment data.
        raise ReportError(
            "uv could not resolve or provision the report environment; "
            "check Python/package availability and worker package-index access",
            code="environment",
        )

def _env_root():
    root = Path(os.environ.get("CAIRN_ENV_CACHE", Path.home() / ".cache/cairn/environments"))
    root.mkdir(parents=True, exist_ok=True)
    return root

def _resolve_environment(declaration):
    declaration = declaration or {}
    if not isinstance(declaration, dict):
        raise ReportError("environment must be a mapping")
    unknown = set(declaration) - {"mode", "python", "dependencies"}
    if unknown:
        raise ReportError(f"Unsupported environment options: {', '.join(sorted(unknown))}")
    mode = declaration.get("mode", "uv" if declaration.get("dependencies") else "current")
    if mode == "current":
        if declaration.get("dependencies"):
            raise ReportError("Dependencies require environment.mode: uv")
        fingerprint = _fingerprint(sys.executable)
        requested = str(declaration.get("python", fingerprint["python"]))
        if (
            not fingerprint["python"].startswith(requested + ".")
            and requested != fingerprint["python"]
        ):
            raise ReportError("The current Python does not match the report environment declaration")
        return {"schema": 1, "mode": "current", "fingerprint": fingerprint}, b""
    if mode != "uv":
        raise ReportError(f"Unsupported report environment mode: {mode}")
    dependencies = declaration.get("dependencies", [])
    if not isinstance(dependencies, list) or not all(isinstance(x, str) for x in dependencies):
        raise ReportError("environment.dependencies must be a list of requirement strings")
    from packaging.requirements import Requirement

    for dependency in dependencies:
        requirement = Requirement(dependency)
        if requirement.url:
            raise ReportError("Direct URL dependencies are not supported in report environments")
    python_version = str(
        declaration.get("python", f"{sys.version_info.major}.{sys.version_info.minor}")
    )
    with tempfile.TemporaryDirectory(prefix="cairn-resolve-") as temp:
        directory = Path(temp)
        requirements = directory / "requirements.in"
        requirements.write_text("\n".join([*dependencies, "ipykernel"]) + "\n")
        locked = directory / "requirements.lock"
        _run_uv(
            [
                "pip",
                "compile",
                str(requirements),
                "--python-version",
                python_version,
                "--generate-hashes",
                "--no-header",
                "--no-annotate",
                "--output-file",
                str(locked),
            ]
        )
        lock = locked.read_bytes()
        preliminary = {
            "schema": 1,
            "mode": "uv",
            "python": python_version,
            "lock_hash": _hash(lock),
        }
        executable = _provision_environment(preliminary, lock)
        fingerprint = _fingerprint(executable)
        return {**preliminary, "python": fingerprint["python"], "fingerprint": fingerprint}, lock

def _provision_environment(spec, lock):
    if spec["mode"] == "current":
        if _fingerprint(sys.executable) != spec["fingerprint"]:
            raise ReportError(
                "Worker environment differs from the pinned current environment. "
                "Prepare the source with environment.mode: uv for portable provisioning",
                code="environment",
            )
        return Path(sys.executable)
    if _hash(lock) != spec["lock_hash"]:
        raise ReportError("Environment lock checksum mismatch", code="corrupt")
    # Lock across processes as well as worker threads on this machine.
    import fcntl

    key = _hash(_json({"python": spec["python"], "lock": spec["lock_hash"]}))
    root = _env_root()
    with _ENV_MUTEX, (root / f"{key}.lock").open("a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        destination = root / key
        executable = destination / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        marker = destination / ".cairn-ready"
        if not marker.exists():
            if destination.exists():
                shutil.rmtree(destination)
            _run_uv(["venv", str(destination), "--python", spec["python"]])
            requirements = destination / "requirements.lock"
            requirements.write_bytes(lock)
            _run_uv(
                ["pip", "sync", str(requirements), "--python", str(executable), "--require-hashes"]
            )
            marker.write_text(spec["lock_hash"])
        if "fingerprint" in spec and _fingerprint(executable) != spec["fingerprint"]:
            raise ReportError(
                "Provisioned environment does not match its recorded fingerprint",
                code="environment",
            )
        return executable
