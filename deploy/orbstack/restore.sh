#!/bin/sh
# Restore self-hosted Cumora from a backup made by backup.sh.
#
#   ./restore.sh                      # the newest backup
#   ./restore.sh <backup folder>      # a specific one (cumora-YYYYMMDD-HHMMSS)
#   ./restore.sh --list               # show the backups it can see
#
# What it does, in order:
#   1. If .env is missing, puts back the backup's copy (the database password
#      and AGENT_RUNTIME_SECRET cannot be regenerated). An existing .env is
#      kept; it only warns if a key differs from the backup's.
#   2. Asks you to type "restore". Nothing is changed before that.
#   3. Backs up the CURRENT state to ~/.cumora/pre-restore, so restoring the
#      wrong backup can be undone with ./restore.sh <that folder>. It lives
#      apart from the daily backups so their 14-copy retention can never
#      delete the backup being restored.
#   4. Stops the server, replaces the database and the uploads volume, starts
#      the server and waits for it to be healthy.
#
# Backups are looked for in CUMORA_BACKUP_DIR, else wherever the daily backup
# (ai.cumora.backup) writes, plus ~/.cumora/backups (where a run lands when an
# external drive was not mounted).
set -eu
cd "$(dirname "$0")"

PATH="$HOME/.orbstack/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

project=${COMPOSE_PROJECT_NAME:-cumora}
uploads_volume="${project}_uploads"
plist="$HOME/Library/LaunchAgents/ai.cumora.backup.plist"
safety_dir=${CUMORA_PRE_RESTORE_DIR:-$HOME/.cumora/pre-restore}

fail() { echo "還原失敗：$*" >&2; exit 1; }

scheduled_dir=$( [ -f "$plist" ] && /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:CUMORA_BACKUP_DIR" "$plist" 2>/dev/null || true)
dirs="${CUMORA_BACKUP_DIR:-${scheduled_dir:-$HOME/.cumora/backups}}"
[ "$dirs" = "$HOME/.cumora/backups" ] || dirs="$dirs
$HOME/.cumora/backups"

# Every complete backup folder, oldest first (names sort by time).
list_backups() {
  printf '%s\n' "$dirs" | while IFS= read -r d; do
    for b in "$d"/cumora-*; do
      [ -f "$b/db.sql.gz" ] && [ -f "$b/uploads.tar.gz" ] && printf '%s\t%s\n' "$(basename "$b")" "$b"
    done
  done | sort | cut -f2
}

case "${1:-}" in
  --list)
    list_backups | while IFS= read -r b; do
      printf '%s  %s%s\n' "$(du -sh "$b" | cut -f1)" "$b" "$([ -f "$b/env" ] && echo '' || echo '  （沒有 env）')"
    done
    exit 0
    ;;
  -*) echo "用法：./restore.sh [備份資料夾 | --list]" >&2; exit 64 ;;
  '') backup=$(list_backups | tail -n 1); [ -n "$backup" ] || fail "找不到任何備份（找過：$(printf '%s' "$dirs" | tr '\n' ' ')）" ;;
  *) backup=${1%/} ;;
esac

[ -f "$backup/db.sql.gz" ] && [ -f "$backup/uploads.tar.gz" ] || fail "$backup 不是完整的備份（要有 db.sql.gz 和 uploads.tar.gz）"
gzip -t "$backup/db.sql.gz" && gzip -t "$backup/uploads.tar.gz" || fail "$backup 的壓縮檔損壞"

# 1. .env
env_restored=
if [ ! -s .env ]; then
  [ -f "$backup/env" ] || fail ".env 不見了，而這份備份裡沒有 env；換一份較新的備份（./restore.sh --list）"
  install -m 600 "$backup/env" .env
  env_restored=1
  echo "已從備份還原 .env"
elif [ -f "$backup/env" ]; then
  differing=$(for key in $(sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' "$backup/env"); do
    [ "$(grep "^$key=" .env || true)" = "$(grep "^$key=" "$backup/env")" ] || printf ' %s' "$key"
  done)
  [ -z "$differing" ] || echo "注意：目前的 .env 跟備份裡的不同：$differing。保留目前的 .env；如果要用備份的，先把 .env 移走再跑一次。" >&2
fi

docker info >/dev/null 2>&1 || fail "Docker 沒有回應（OrbStack 沒開？）"
[ -n "$(docker compose ps -q postgres 2>/dev/null)" ] || fail "postgres 沒在執行；先跑 ./up.sh"

# 2. Confirm
echo "要還原的備份：$backup（$(du -sh "$backup" | cut -f1)）"
echo "這會覆蓋目前的資料庫和上傳檔案。輸入 restore 繼續："
read -r answer || answer=
if [ "$answer" != restore ]; then
  if [ -n "$env_restored" ]; then echo "已取消。只還原了 .env，資料庫和上傳檔案沒動。"; else echo "已取消，沒有改動任何東西。"; fi
  exit 1
fi

# 3. Safety backup of the current state
before=$(ls -1d "$safety_dir"/cumora-* 2>/dev/null | tail -n 1 || true)
CUMORA_BACKUP_DIR="$safety_dir" CUMORA_BACKUP_KEEP=5 ./backup.sh || fail "還原前的備份失敗，沒有改動任何東西"
safety=$(ls -1d "$safety_dir"/cumora-* | tail -n 1)
[ "$safety" != "$before" ] || fail "找不到剛做好的還原前備份，沒有改動任何東西"

undo="要回到還原前的狀態：./restore.sh $safety"

# 4. Replace the data
docker compose stop server
gunzip -c "$backup/db.sql.gz" \
  | docker compose exec -T postgres psql -q -U cumora -d cumora -v ON_ERROR_STOP=1 >/dev/null \
  || fail "資料庫還原中斷。$undo"
docker run --rm -i -v "$uploads_volume:/data" --entrypoint sh pgvector/pgvector:pg16 \
  -c 'find /data -mindepth 1 -delete && tar -C /data -xzf -' < "$backup/uploads.tar.gz" \
  || fail "上傳檔案還原中斷。$undo"
docker compose start server

container=$(docker compose ps -q server)
status=starting
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  sleep 2
done
[ "$status" = healthy ] || fail "伺服器沒有恢復正常（$status），看 docker compose logs server。$undo"

users=$(docker compose exec -T postgres psql -U cumora -d cumora -tAc 'select count(*) from users')
echo "還原完成：$backup（$users 個帳號）。"
echo "$undo"
