#!/usr/bin/env bash
# Start the host-native AI workers (real models must run on the host: Docker
# cannot access MPS/CoreML). Logs and pid files live under worker/logs/.
# Note: the legacy rag_worker was retired — knowledge ingest/search now goes
# through the rag-service (zvec FTS) microservice in Docker.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p logs

is_running() {
  [ -f "logs/$1.pid" ] && kill -0 "$(cat "logs/$1.pid")" 2>/dev/null
}

start_one() {
  local name="$1" script="$2"
  if is_running "$name"; then
    echo "[skip] $name already running (pid $(cat "logs/$name.pid"))"
    return
  fi
  nohup uv run --no-sync python -u "$script" >> "logs/$name.log" 2>&1 &
  echo $! > "logs/$name.pid"
  echo "[started] $name (pid $!) -> logs/$name.log"
}

start_one worker worker.py
start_one stream_worker stream_worker.py

echo "workers starting; logs under $(pwd)/logs/"
