#!/usr/bin/env bash
# Restart the host-native AI workers: stop everything, then start fresh.
set -euo pipefail
cd "$(dirname "$0")"

./stop_workers.sh
./start_workers.sh
