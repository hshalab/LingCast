#!/usr/bin/env bash
set -e

echo "Starting LingCast AI Workers in Docker container..."

# Terminate all child processes on exit signal
cleanup() {
    echo "Stopping worker processes..."
    kill $(jobs -p) 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM EXIT

python3 -u worker.py &
PID1=$!
echo "Started worker.py (PID $PID1)"

python3 -u stream_worker.py &
PID2=$!
echo "Started stream_worker.py (PID $PID2)"

wait -n $PID1 $PID2
