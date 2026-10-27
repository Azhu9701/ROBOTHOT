#!/usr/bin/env python3
"""Mac-local runtime. Credentials stay in a private runtime file, outside Git."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import secrets
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = Path.home() / "Library/Application Support/ROBOTHOT"
ENVFILE = RUNTIME / "recruitment.env"
NODE = "/Users/mac/node24/bin/node"
LABEL = "world.aiman.robothot"

def run(argv, **kwargs):
    return subprocess.run(argv, check=True, **kwargs)

def environment():
    return {k: json.loads(v) for k, v in (line.split("=", 1) for line in ENVFILE.read_text().splitlines() if "=" in line)}

def prepare():
    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not ENVFILE.exists():
        password = secrets.token_hex(24)
        values = {
            "DATABASE_URL": f"postgres://recruitment:{password}@127.0.0.1:55446/robothot_recruitment",
            "SESSION_SECRET": secrets.token_hex(32), "IMG_PROXY_SIGN_SECRET": secrets.token_hex(32),
            "ADMIN_PASSWORD": secrets.token_hex(24), "AIHOT_ENVIRONMENT": "recruitment-local",
            "AIHOT_DATA_DIR": str(RUNTIME / "data"), "AIHOT_CREDENTIALS_DIR": str(RUNTIME / "unused-credentials"),
            "SITE_URL": "http://127.0.0.1:3034", "API_PORT": "3033", "API_HOST": "127.0.0.1",
            "API_BASE_URL": "http://127.0.0.1:3033", "WEB_PORT": "3034", "WEB_HOST": "127.0.0.1",
            "NODE_ENV": "production", "RECRUITMENT_ENABLED": "true", "COLLECT_ENABLED": "true",
            "MODEL_CALLS_ENABLED": "false", "FEISHU_CONTENT_PUSH_ENABLED": "false",
            "FEISHU_INTERNAL_ENABLED": "false", "INDEXNOW_SUBMIT_ENABLED": "false",
            "PATH": "/Users/mac/node24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        }
        fd = os.open(ENVFILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write("".join(f"{k}={json.dumps(v)}\n" for k, v in values.items()))
    values = environment()
    from urllib.parse import urlparse
    password = urlparse(values["DATABASE_URL"]).password
    exists = subprocess.run(["docker", "container", "inspect", "robothot-recruitment-db"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not exists:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", 55446)) == 0:
                raise RuntimeError("port 55446 is in use; refusing to replace an existing service")
        run(["docker", "run", "-d", "--name", "robothot-recruitment-db", "--restart", "unless-stopped",
             "-p", "127.0.0.1:55446:5432", "-v", "robothot-recruitment-pg17:/var/lib/postgresql/data",
             "-e", "POSTGRES_USER=recruitment", "-e", "POSTGRES_DB=robothot_recruitment", "-e", "POSTGRES_PASSWORD", "postgres:17-alpine"],
            env={**os.environ, "POSTGRES_PASSWORD": password}, stdout=subprocess.DEVNULL)
    else:
        run(["docker", "start", "robothot-recruitment-db"], stdout=subprocess.DEVNULL)
    for _ in range(30):
        if subprocess.run(["docker", "exec", "robothot-recruitment-db", "pg_isready", "-U", "recruitment"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("recruitment database not ready")
    run([NODE, f"--env-file={ENVFILE}", "scripts/migrate.ts"], cwd=ROOT)
    print("Mac recruitment database and private runtime prepared")

def activate():
    if not ENVFILE.exists():
        raise RuntimeError("prepare first")
    agents = Path.home() / "Library/LaunchAgents"
    agents.mkdir(exist_ok=True)
    definitions = {
        "recruitment": {"ProgramArguments": [NODE, f"--env-file={ENVFILE}", "modules/recruitment/scripts/run.ts"], "StartInterval": 3600, "RunAtLoad": True},
        "api": {"ProgramArguments": [NODE, f"--env-file={ENVFILE}", "apps/api/src/main.ts"], "KeepAlive": True, "RunAtLoad": True},
        "web": {"ProgramArguments": [NODE, f"--env-file={ENVFILE}", "apps/web/server.ts"], "KeepAlive": True, "RunAtLoad": True},
    }
    for name, settings in definitions.items():
        label = f"{LABEL}.{name}"
        p = agents / f"{label}.plist"
        settings.update(Label=label, WorkingDirectory=str(ROOT), ThrottleInterval=30,
                        StandardOutPath=str(RUNTIME / f"{name}.log"), StandardErrorPath=str(RUNTIME / f"{name}.error.log"))
        raw = plistlib.dumps(settings)
        if p.exists() and p.read_bytes() != raw:
            raise RuntimeError(f"existing launch agent differs: {label}; review before changing")
        if not p.exists():
            p.write_bytes(raw)
            p.chmod(0o600)
        service = f"gui/{os.getuid()}/{label}"
        if subprocess.run(["launchctl", "print", service], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
            run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(p)])
    print("Hourly collection and local ROBOTHOT started: http://127.0.0.1:3034/jobs")

if __name__ == "__main__":
    if sys.platform != "darwin":
        raise RuntimeError("this runtime belongs on the Mac")
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "activate"])
    action = parser.parse_args().action
    (prepare if action == "prepare" else activate)()
