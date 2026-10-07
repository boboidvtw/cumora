#!/bin/sh
# Back up self-hosted Cumora: the Postgres database, the uploads volume and .env.
#
#   ./backup.sh               # take one backup now
#   ./backup.sh --install     # run it every day at 03:30 (launchd)
#   ./backup.sh --uninstall   # stop the daily run (backups already taken stay)
#
# Each backup is a folder <dir>/cumora-YYYYMMDD-HHMMSS with db.sql.gz,
# uploads.tar.gz and env (a copy of .env). .env holds the two secrets that are
# already baked into the data (POSTGRES_PASSWORD, AGENT_RUNTIME_SECRET) and
# cannot be regenerated, so the folder is private to this user. It is written under a temporary name and renamed only once
# both files check out, so a half-written backup never counts as one.
#
#   CUMORA_BACKUP_DIR    where backups go (default ~/.cumora/backups)
#   CUMORA_BACKUP_KEEP   how many to keep (default 14; older ones are deleted)
#   CUMORA_BACKUP_OFFSITE_DIR   also write an encrypted copy here, e.g. a
#                        Google Drive for desktop folder (see offsite-crypto.sh)
#   CUMORA_BACKUP_OFFSITE_KEEP  how many encrypted copies to keep (default 30)
#
# The off-site copy is written after the local backup is complete and is
# checked by decrypting it again before it gets its final name. If it fails,
# the local backup still counts; you get a notification instead.
#
# Redis is not backed up: it holds queues and short-lived state that the
# server rebuilds.
set -eu
cd "$(dirname "$0")"
here=$(pwd)

# launchd starts us with a bare PATH; OrbStack's docker lives in one of these.
PATH="$HOME/.orbstack/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

dest=${CUMORA_BACKUP_DIR:-$HOME/.cumora/backups}
keep=${CUMORA_BACKUP_KEEP:-14}
offsite=${CUMORA_BACKUP_OFFSITE_DIR:-}
offsite_keep=${CUMORA_BACKUP_OFFSITE_KEEP:-30}
. "$here/offsite-crypto.sh"
label=ai.cumora.backup
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/.cumora/backup.log"

case "${1:-}" in
  --install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.cumora"
    offsite_env=
    if [ -n "$offsite" ]; then
      case "$offsite" in *[\<\>\&]*) echo "CUMORA_BACKUP_OFFSITE_DIR 不能含 < > &" >&2; exit 64 ;; esac
      offsite_passphrase >/dev/null || { echo "鑰匙圈裡沒有 $OFFSITE_KEYCHAIN_SERVICE 密碼，見 offsite-crypto.sh" >&2; exit 1; }
      offsite_env="    <key>CUMORA_BACKUP_OFFSITE_DIR</key><string>$offsite</string>
    <key>CUMORA_BACKUP_OFFSITE_KEEP</key><string>$offsite_keep</string>"
    fi
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>$here/backup.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$here</string>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>$HOME</string>
    <key>CUMORA_BACKUP_DIR</key><string>$dest</string>
    <key>CUMORA_BACKUP_KEEP</key><string>$keep</string>
$offsite_env
  </dict>
</dict></plist>
PLIST
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load "$plist"
    echo "已設定每天 03:30 自動備份（Mac 當時在睡眠的話，醒來後補跑）。"
    echo "備份位置：$dest（保留最近 $keep 份）"
    [ -z "$offsite" ] || echo "加密異地副本：$offsite（保留最近 $offsite_keep 份）"
    echo "日誌：$log"
    exit 0
    ;;
  --uninstall)
    launchctl unload "$plist" 2>/dev/null || true
    rm -f "$plist"
    echo "已取消自動備份。已經做好的備份仍在 $dest。"
    exit 0
    ;;
  '') ;;
  *) echo "用法：./backup.sh [--install | --uninstall]" >&2; exit 64 ;;
esac

stamp() { date '+%Y-%m-%d %H:%M:%S'; }
# A failed nightly run would otherwise only reach backup.log, so say it out
# loud: OrbStack left closed means no backups, night after night, unnoticed.
fail() {
  echo "$(stamp) 備份失敗：$*" >&2
  notify "Cumora 備份失敗" "$*。詳情：~/.cumora/backup.log"
  exit 1
}
notify() {
  # Drop quotes and backslashes so a reason can never break the AppleScript.
  t=$(printf '%s' "$1" | tr -d '"\\')
  b=$(printf '%s' "$2" | tr -d '"\\')
  osascript -e "display notification \"$b\" with title \"$t\"" >/dev/null 2>&1 || true
}

# A backup dir on an external drive (/Volumes/<name>/...) only exists while the
# drive is mounted. Without it, back up to the internal disk rather than skip
# the day. An unmounted /Volumes/<name> is either missing or a plain folder on
# the boot volume, so compare devices instead of parsing mount output.
case "$dest" in
  /Volumes/*)
    vol="/Volumes/$(printf '%s' "${dest#/Volumes/}" | cut -d/ -f1)"
    if [ ! -d "$vol" ] || [ "$(stat -f %d "$vol")" = "$(stat -f %d /)" ]; then
      echo "$(stamp) 警告：$vol 沒有掛載，這次先備份到 $HOME/.cumora/backups" >&2
      notify "Cumora 備份" "外接碟沒接上，這次先備份到內建磁碟。"
      dest="$HOME/.cumora/backups"
    fi
    ;;
esac

docker info >/dev/null 2>&1 || fail "Docker 沒有回應（OrbStack 沒開？）"
[ -n "$(docker compose ps -q postgres 2>/dev/null)" ] || fail "Cumora 的 postgres 沒在執行（先跑 ./up.sh）"

mkdir -p "$dest"
name="cumora-$(date +%Y%m%d-%H%M%S)"
tmp="$dest/.$name.partial"
rm -rf "$tmp"
mkdir -m 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT

# --clean --if-exists makes the dump restorable over an existing database.
docker compose exec -T postgres pg_dump -U cumora --clean --if-exists cumora > "$tmp/db.sql" \
  || fail "pg_dump 失敗"
tail -n 5 "$tmp/db.sql" | grep -q 'PostgreSQL database dump complete' \
  || fail "資料庫備份不完整（缺結尾標記）"
gzip "$tmp/db.sql"

# Read the volume through a throwaway container so this works with the
# server stopped; the postgres image is already on this machine.
docker run --rm -v "${COMPOSE_PROJECT_NAME:-cumora}_uploads:/data:ro" --entrypoint tar pgvector/pgvector:pg16 \
  -C /data -czf - . > "$tmp/uploads.tar.gz" \
  || fail "上傳檔案備份失敗"

gzip -t "$tmp/db.sql.gz" && gzip -t "$tmp/uploads.tar.gz" || fail "壓縮檔驗證失敗"

[ -s .env ] || fail ".env 不見了；先跑 ./restore.sh 從備份放回來"
(umask 077 && cp .env "$tmp/env") || fail ".env 備份失敗"

mv "$tmp" "$dest/$name"
trap - EXIT

# Keep the newest $keep backups. Names sort by time, so drop from the front.
count=$(ls -1d "$dest"/cumora-* 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt "$keep" ]; then
  ls -1d "$dest"/cumora-* | head -n $((count - keep)) | while read -r old; do
    rm -rf "$old"
  done
fi

size=$(du -sh "$dest/$name" | cut -f1)
echo "$(stamp) 備份完成：$dest/$name（$size），保留最近 $keep 份"

# Off-site copy: one encrypted file next to the others in $offsite.
[ -n "$offsite" ] || exit 0
offsite_fail() {
  echo "$(stamp) 異地備份失敗：$*（本機備份 $dest/$name 已完成）" >&2
  notify "Cumora 異地備份失敗" "$*。本機備份已完成，詳情：~/.cumora/backup.log"
  exit 1
}
mkdir -p "$offsite" || offsite_fail "建立不了 $offsite"
enc="$offsite/$name.tar.xz.enc"
part="$offsite/.$name.tar.xz.enc.partial"
trap 'rm -f "$part"' EXIT
tar -C "$dest" -cJf - "$name" | offsite_encrypt > "$part" || offsite_fail "加密失敗（鑰匙圈裡有 $OFFSITE_KEYCHAIN_SERVICE 密碼嗎？）"
offsite_decrypt < "$part" | tar -tJf - >/dev/null || offsite_fail "加密檔驗證失敗"
mv "$part" "$enc"
trap - EXIT

count=$(ls -1 "$offsite"/cumora-*.tar.xz.enc 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt "$offsite_keep" ]; then
  ls -1 "$offsite"/cumora-*.tar.xz.enc | head -n $((count - offsite_keep)) | while read -r old; do
    rm -f "$old"
  done
fi
echo "$(stamp) 異地副本完成：$enc（$(du -h "$enc" | cut -f1)），保留最近 $offsite_keep 份"
