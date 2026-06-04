#!/bin/bash
set -e

echo "Running season setup..."
node scripts/restart-season.js

prune_market_data_loop() {
  while true; do
    node scripts/prune-old-market-data.js || echo "Market data prune failed; retrying in 24 hours."
    sleep 86400
  done
}

prune_market_data_loop &
PRUNE_PID=$!

./engine &
ENGINE_PID=$!

node app.js &
APP_PID=$!

term() {
  kill "$PRUNE_PID" "$ENGINE_PID" "$APP_PID" 2>/dev/null || true
  wait "$PRUNE_PID" "$ENGINE_PID" "$APP_PID" 2>/dev/null || true
}

trap term INT TERM

wait -n "$ENGINE_PID" "$APP_PID"
term
