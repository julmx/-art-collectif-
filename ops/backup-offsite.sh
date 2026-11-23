#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_HOST:?BACKUP_HOST required}" "${BACKUP_REMOTE_DIR:?BACKUP_REMOTE_DIR required}" "${BACKUP_STATE_DIR:?BACKUP_STATE_DIR required}" "${PROJECT_DIR:?PROJECT_DIR required}"
[[ "$BACKUP_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]*$ ]] || { echo 'Invalid BACKUP_HOST' >&2; exit 1; }
[[ "$BACKUP_REMOTE_DIR" =~ ^/[A-Za-z0-9_/-]+$ && "$BACKUP_REMOTE_DIR" != *..* ]] || { echo 'Invalid BACKUP_REMOTE_DIR' >&2; exit 1; }
if [[ -n "${BACKUP_RETENTION_COUNT:-}" ]]; then
  [[ "$BACKUP_RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid BACKUP_RETENTION_COUNT' >&2; exit 1; }
fi
mkdir -p "$BACKUP_STATE_DIR"
chmod 700 "$BACKUP_STATE_DIR"
exec 9>"$BACKUP_STATE_DIR/backup.lock"
flock -n 9 || exit 0
cd "$PROJECT_DIR"
started=$(date -u +%s)
id="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
stage=$(mktemp -d "$BACKUP_STATE_DIR/.backup.XXXXXXXX")
cleanup() { rm -rf -- "$stage"; docker compose exec -T app rm -rf -- "/data/backup-staging/$id" >/dev/null 2>&1 || true; }
trap cleanup EXIT
mkdir -p "$stage/capture"
docker compose exec -T app mkdir -p /data/backup-staging
docker compose exec -T app node --import tsx scripts/backup.ts /data/art.sqlite "/data/backup-staging/$id"
docker compose cp "app:/data/backup-staging/$id/." "$stage/capture/"
install -m 600 .env "$stage/capture/deployment.env"
(cd "$stage/capture" && sha256sum deployment.env >> SHA256SUMS && sha256sum -c SHA256SUMS)
ssh -o BatchMode=yes -- "$BACKUP_HOST" "umask 077; mkdir -p '$BACKUP_REMOTE_DIR/$id'"
rsync -a --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= -e 'ssh -o BatchMode=yes' "$stage/capture/" "$BACKUP_HOST:$BACKUP_REMOTE_DIR/$id/"
ssh -o BatchMode=yes -- "$BACKUP_HOST" "cd '$BACKUP_REMOTE_DIR/$id' && sha256sum -c SHA256SUMS"
printf '%s %s\n' "$started" "$id" > "$BACKUP_STATE_DIR/verified.tmp"
chmod 600 "$BACKUP_STATE_DIR/verified.tmp"
mv -f "$BACKUP_STATE_DIR/verified.tmp" "$BACKUP_STATE_DIR/verified"

if [[ -n "${BACKUP_RETENTION_COUNT:-}" ]]; then
  ssh -o BatchMode=yes -- "$BACKUP_HOST" sh -s -- "$BACKUP_REMOTE_DIR" "$BACKUP_RETENTION_COUNT" <<'EOF'
set -eu
LC_ALL=C
export LC_ALL
remote_dir=$1
retention=$2
cd "$remote_dir"
count=0
ls -1r | while IFS= read -r entry; do
  [ -d "$entry" ] && [ ! -L "$entry" ] || continue
  case "$entry" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
      count=$((count + 1))
      if [ "$count" -gt "$retention" ]; then
        rm -rf -- "./$entry"
      fi
      ;;
  esac
done
EOF
fi
