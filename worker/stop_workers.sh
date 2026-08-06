#!/usr/bin/env bash
# Stop the host-native workers started by start_workers.sh.
set -uo pipefail
cd "$(dirname "$0")"

stop_one() {
  local name="$1"
  if [ ! -f "logs/$name.pid" ]; then
    echo "[skip] $name not tracked"
    return
  fi
  local pid
  pid="$(cat "logs/$name.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    # uv run spawns a python child; make sure the interpreter goes too.
    pkill -P "$pid" 2>/dev/null || true
    echo "[stopped] $name (pid $pid)"
  else
    echo "[skip] $name not running"
  fi
  rm -f "logs/$name.pid"
}

# Fallback: also stop any matching instances that were started manually or by
# an older start_workers.sh run (no pid file / stale pid file), e.g. after a
# terminal was closed the process gets reparented to launchd (PPID 1) and the
# pid file may have been overwritten by a later run.
stop_by_pattern() {
  local script="$1"
  # uv run parent processes.
  pgrep -f "uv run --no-sync python -u $script" 2>/dev/null | while read -r pid; do
    [ "$pid" = "$$" ] && continue
    kill "$pid" 2>/dev/null || true
    pkill -P "$pid" 2>/dev/null || true
  done
  # Direct python interpreters (e.g. launched without `uv run`).
  pgrep -f "\.venv/bin/python3 -u $script" 2>/dev/null | while read -r pid; do
    [ "$pid" = "$$" ] && continue
    kill "$pid" 2>/dev/null || true
  done
}

stop_one worker
stop_one stream_worker
stop_one rag_worker
stop_by_pattern worker.py
stop_by_pattern stream_worker.py
stop_by_pattern rag_worker.py

echo "done"
