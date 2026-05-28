#!/bin/bash
set -e

echo "Running season setup..."
node scripts/restart-season.js

./engine &
ENGINE_PID=$!

node app.js &
APP_PID=$!

term() {
  kill "$ENGINE_PID" "$APP_PID" 2>/dev/null || true
  wait "$ENGINE_PID" "$APP_PID" 2>/dev/null || true
}

trap term INT TERM

wait -n "$ENGINE_PID" "$APP_PID"
term
