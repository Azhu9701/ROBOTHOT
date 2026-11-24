#!/usr/bin/env python3
"""Use the local isolated server, with per-file throwaway test databases."""
import importlib.util
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse, urlunparse

installer = Path(__file__).with_name("install-local.py")
spec = importlib.util.spec_from_file_location("local_runtime", installer)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
url = urlparse(runtime.environment()["DATABASE_URL"])
env = {**os.environ, "PATH": "/Users/mac/node24/bin:/opt/homebrew/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
       "DATABASE_URL": urlunparse(url._replace(path="/robothot_recruitment_test")), "NODE_ENV": "test"}
result = subprocess.run(["/Users/mac/node24/bin/npm", "test"], cwd=runtime.ROOT, env=env, capture_output=True, text=True)
safe = re.sub(r"postgres(?:ql)?://[^@\s\x27\x22]+@", "postgres://<redacted>@", result.stdout + "\n" + result.stderr)
log = runtime.RUNTIME / "recruitment-test.log"
log.write_text(safe)
log.chmod(0o600)
print(safe[-4000:])
print("test_rc", result.returncode)
print("log", str(log))
raise SystemExit(result.returncode)
