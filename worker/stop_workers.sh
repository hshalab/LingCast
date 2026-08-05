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

stop_one worker
stop_one stream_worker
