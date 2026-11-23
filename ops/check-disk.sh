#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_DIR:?PROJECT_DIR required}"
cd "$PROJECT_DIR"

# Check the persistent and temporary filesystems from inside the container that writes to them.
output=$(docker compose exec -T app df -P /data /tmp) || {
  echo 'CRITICAL: capacité de /data ou /tmp illisible' >&2
  exit 2
}
data_usage=$(awk 'NR==2 { gsub(/%/, "", $5); print $5 }' <<< "$output")
tmp_usage=$(awk 'NR==3 { gsub(/%/, "", $5); print $5 }' <<< "$output")

[[ "$data_usage" =~ ^[0-9]+$ && "$tmp_usage" =~ ^[0-9]+$ ]] || {
  echo 'CRITICAL: capacité de /data ou /tmp illisible' >&2
  exit 2
}

max_usage=$data_usage
if (( 10#$tmp_usage > 10#$max_usage )); then
  max_usage=$tmp_usage
fi

summary="/data occupé à ${data_usage} %, /tmp occupé à ${tmp_usage} %"
if (( 10#$max_usage >= 90 )); then
  echo "CRITICAL: $summary" >&2
  exit 2
fi
if (( 10#$max_usage >= 80 )); then
  echo "WARNING: $summary" >&2
  exit 1
fi
printf 'OK: %s\n' "$summary"
