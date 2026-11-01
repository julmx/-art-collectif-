#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_DIR:?PROJECT_DIR required}"
cd "$PROJECT_DIR"
# Check the persistent filesystem from inside the same container that writes to it.
usage=$(docker compose exec -T app df -P /data | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
[[ "$usage" =~ ^[0-9]+$ ]] || { echo 'CRITICAL: capacité du volume illisible' >&2; exit 2; }
if (( usage >= 90 )); then echo "CRITICAL: volume occupé à $usage %" >&2; exit 2; fi
if (( usage >= 80 )); then echo "WARNING: volume occupé à $usage %" >&2; exit 1; fi
printf 'OK: volume occupé à %s %%\n' "$usage"
