#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_HOST:?BACKUP_HOST required}" "${BACKUP_REMOTE_DIR:?BACKUP_REMOTE_DIR required}" "${BACKUP_STATE_DIR:?BACKUP_STATE_DIR required}"
[[ "$BACKUP_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]*$ && "$BACKUP_REMOTE_DIR" =~ ^/[A-Za-z0-9_/-]+$ && "$BACKUP_REMOTE_DIR" != *..* ]] || exit 2
if [[ ! -f "$BACKUP_STATE_DIR/verified" ]]; then echo 'CRITICAL: aucune sauvegarde extérieure vérifiée' >&2; exit 2; fi
read -r timestamp id < "$BACKUP_STATE_DIR/verified"
[[ "$timestamp" =~ ^[0-9]+$ && "$id" =~ ^[0-9TZ-]+[a-f0-9]+$ ]] || { echo 'CRITICAL: état de sauvegarde invalide' >&2; exit 2; }
if ! ssh -o BatchMode=yes -o ConnectTimeout=15 -- "$BACKUP_HOST" "cd '$BACKUP_REMOTE_DIR/$id' && sha256sum -c SHA256SUMS" >/dev/null; then echo 'CRITICAL: sauvegarde extérieure inaccessible ou invalide' >&2; exit 2; fi
age=$(( $(date -u +%s) - timestamp ))
if (( age >= 3600 )); then echo "CRITICAL: point récupérable vieux de $age secondes ; objectif dépassé" >&2; exit 2; fi
if (( age >= 2700 )); then echo "WARNING: point récupérable vieux de $age secondes" >&2; exit 1; fi
printf 'OK: point récupérable vieux de %s secondes\n' "$age"
