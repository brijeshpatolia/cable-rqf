#!/usr/bin/env bash
# Starts the container's Postgres if it is not already accepting connections.
# The sandbox stops it on restart, so this is idempotent and safe to re-run.
set -e
if pg_isready -q 2>/dev/null; then exit 0; fi
pg_ctlcluster 16 main start 2>/dev/null || service postgresql start >/dev/null 2>&1 || true
for _ in $(seq 1 20); do pg_isready -q 2>/dev/null && exit 0; sleep 0.5; done
echo "postgres did not start" >&2; exit 1
