#!/bin/sh
# Back up self-hosted Cumora: the Postgres database, the uploads volume and .env.
#
#   ./backup.sh               # take one backup now
#   ./backup.sh --install     # run it every day at 03:30 (launchd); again
#                             # later keeps the installed settings
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
#   CUMORA_BACKUP_OFFSITE_KEEP  how many copies to keep (default 30)
#   CUMORA_BACKUP_OFFSITE_ENCRYPT  1 (default) encrypts the copy; 0 writes a
#                        plain .tar.xz, which carries .env's secrets in the
#                        clear, so only for a folder only you can read
#   CUMORA_BACKUP_DRILL_DAYS  after a good backup, run ./restore-drill.sh when
#                        the last passing drill is this many days old
#                        (default 30; 0 turns it off). A failed drill is
#                        retried with the next backup.
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

label=ai.cumora.backup
plist="$HOME/Library/LaunchAgents/$label.plist"

# Running --install again (say, to change how many to keep) keeps what the
# installed job already has: anything not given on this command line is read
# back from its plist. Without this, a bare re-run silently moved backups back
# to ~/.cumora/backups and turned off the off-site copy. KEY= clears a value.
if [ "${1:-}" = --install ] && [ -f "$plist" ]; then
  for k in CUMORA_BACKUP_DIR CUMORA_BACKUP_KEEP CUMORA_BACKUP_DRILL_DAYS \
           CUMORA_BACKUP_OFFSITE_DIR CUMORA_BACKUP_OFFSITE_KEEP CUMORA_BACKUP_OFFSITE_ENCRYPT; do
    eval "[ -n \"\${$k+x}\" ]" && continue
    v=$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$k" "$plist" 2>/dev/null) || continue
    export "$k=$v"
  done
fi

dest=${CUMORA_BACKUP_DIR:-$HOME/.cumora/backups}
keep=${CUMORA_BACKUP_KEEP:-14}
offsite=${CUMORA_BACKUP_OFFSITE_DIR:-}
offsite_keep=${CUMORA_BACKUP_OFFSITE_KEEP:-30}
offsite_encrypt=${CUMORA_BACKUP_OFFSITE_ENCRYPT:-1}
drill_days=${CUMORA_BACKUP_DRILL_DAYS:-30}
. "$here/offsite-crypto.sh"
log="$HOME/.cumora/backup.log"

case "${1:-}" in
  --install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.cumora"
    offsite_env=
    if [ -n "$offsite" ]; then
      case "$offsite" in *[\<\>\&]*) echo "CUMORA_BACKUP_OFFSITE_DIR 不能含 < > &" >&2; exit 64 ;; esac
      [ "$offsite_encrypt" = 0 ] || offsite_passphrase >/dev/null || { echo "鑰匙圈裡沒有 $OFFSITE_KEYCHAIN_SERVICE 密碼，見 offsite-crypto.sh" >&2; exit 1; }
      offsite_env="    <key>CUMORA_BACKUP_OFFSITE_DIR</key><string>$offsite</string>
    <key>CUMORA_BACKUP_OFFSITE_KEEP</key><string>$offsite_keep</string>
    <key>CUMORA_BACKUP_OFFSITE_ENCRYPT</key><string>$offsite_encrypt</string>"
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
    <key>CUMORA_BACKUP_DRILL_DAYS</key><string>$drill_days</string>
$offsite_env
  </dict>
</dict></plist>
PLIST
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load "$plist"
    echo "已設定每天 03:30 自動備份（Mac 當時在睡眠的話，醒來後補跑）。"
    echo "備份位置：$dest（保留最近 $keep 份）"
    if [ -n "$offsite" ]; then
      if [ "$offsite_encrypt" = 0 ]; then echo "異地副本（不加密，內含 .env 的密鑰）：$offsite（保留最近 $offsite_keep 份）"
      else echo "加密異地副本：$offsite（保留最近 $offsite_keep 份）"; fi
    fi
    [ "$drill_days" = 0 ] || echo "還原演練：上次演練通過滿 $drill_days 天時，備份完順便演練一次（./restore-drill.sh）"
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

# Retention. Listing the folder is the truth, but under launchd macOS (TCC)
# won't let this job list ~/Downloads or a Google Drive folder, nor delete
# files there it didn't create; it may delete what it wrote itself. So when
# listing is refused, this job keeps an index of what it wrote and prunes by
# that. Backups made from Terminal are then neither counted nor deleted; the
# next run from Terminal (which can list) cleans up everything.
index=${CUMORA_BACKUP_INDEX:-$HOME/.cumora/backup-index}
can_list() { ls "$1" >/dev/null 2>&1; }
# No index yet: everything this job wrote so far is in its log.
seed_index() {
  [ -f "$index" ] || sed -n 's#.*完成：\(/.*\)（.*#\1#p' "$log" > "$index" 2>/dev/null || : > "$index"
}
# Backups directly in $1 (cumora-*) that the index knows and that still exist.
indexed_in() {
  seed_index
  awk -v p="$1/cumora-" 'index($0, p) == 1 && index(substr($0, length(p) + 1), "/") == 0 && !seen[$0]++' "$index" \
    | while IFS= read -r b; do [ -e "$b" ] && printf '%s\n' "$b"; done
}
remember() { can_list "$(dirname "$1")" || { seed_index; printf '%s\n' "$1" >> "$index"; }; }
# Delete all but the newest $2 backups in $1. Names sort by time.
prune() {
  all=$(if can_list "$1"; then
          for b in "$1"/cumora-*; do [ -e "$b" ] && printf '%s\n' "$b"; done
        else
          indexed_in "$1"
        fi | awk -F/ '{ print $NF "\t" $0 }' | sort | cut -f2-)
  count=$(printf '%s' "$all" | grep -c . || true)
  [ "$count" -gt "$2" ] || return 0
  printf '%s\n' "$all" | head -n $((count - $2)) | while IFS= read -r old; do
    rm -rf "$old" 2>/dev/null || true
    [ ! -e "$old" ] || echo "$(stamp) 警告：刪不掉舊備份 $old（從終端機跑一次 ./backup.sh 就會清掉）" >&2
  done
  # Forget what is gone, so the index stays as small as what is kept.
  if [ -f "$index" ]; then
    while IFS= read -r b; do [ -e "$b" ] && printf '%s\n' "$b"; done < "$index" > "$index.new" && mv "$index.new" "$index"
  fi
}

mv "$tmp" "$dest/$name"
trap - EXIT
remember "$dest/$name"
prune "$dest" "$keep"

size=$(du -sh "$dest/$name" | cut -f1)
echo "$(stamp) 備份完成：$dest/$name（$size），保留最近 $keep 份"

# Restore drill, when one is due, on the backup just written ($1). Under
# launchd macOS (TCC) lets this job read files it created itself but not list
# ~/Downloads or a Google Drive folder, so the drill gets the exact path.
maybe_drill() {
  [ "$drill_days" != 0 ] && [ -x "$here/restore-drill.sh" ] || return 0
  drill_last="$HOME/.cumora/restore-drill.last"
  if [ -f "$drill_last" ]; then
    IFS="$(printf '\t')" read -r result at _ < "$drill_last" || true
    [ "${result:-}" != ok ] || [ $(( ($(date +%s) - ${at:-0}) / 86400 )) -ge "$drill_days" ] || return 0
  fi
  "$here/restore-drill.sh" "$1" || true   # it records and notifies by itself
}

# Off-site copy: one file next to the others in $offsite.
[ -n "$offsite" ] || { maybe_drill "$dest/$name"; exit 0; }
offsite_fail() {
  echo "$(stamp) 異地備份失敗：$*（本機備份 $dest/$name 已完成）" >&2
  notify "Cumora 異地備份失敗" "$*。本機備份已完成，詳情：~/.cumora/backup.log"
  exit 1
}
mkdir -p "$offsite" || offsite_fail "建立不了 $offsite"
if [ "$offsite_encrypt" = 0 ]; then
  enc="$offsite/$name.tar.xz"
  part="$offsite/.$name.tar.xz.partial"
  trap 'rm -f "$part"' EXIT
  tar -C "$dest" -cJf - "$name" > "$part" || offsite_fail "打包失敗"
  tar -tJf "$part" >/dev/null || offsite_fail "副本驗證失敗"
else
  enc="$offsite/$name.tar.xz.enc"
  part="$offsite/.$name.tar.xz.enc.partial"
  trap 'rm -f "$part"' EXIT
  tar -C "$dest" -cJf - "$name" | offsite_encrypt > "$part" || offsite_fail "加密失敗（鑰匙圈裡有 $OFFSITE_KEYCHAIN_SERVICE 密碼嗎？）"
  offsite_decrypt < "$part" | tar -tJf - >/dev/null || offsite_fail "加密檔驗證失敗"
fi
mv "$part" "$enc"
trap - EXIT
# Plain and encrypted copies share one retention count.
remember "$enc"
prune "$offsite" "$offsite_keep"
echo "$(stamp) 異地副本完成：$enc（$(du -h "$enc" | cut -f1)），保留最近 $offsite_keep 份"
maybe_drill "$enc"
