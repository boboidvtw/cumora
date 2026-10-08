#!/bin/sh
# Check yetone/cumora for commits the zh-tw branch doesn't have yet, and send
# a macOS notification when there are new ones. Never merges anything.
#
#   ./check-upstream.sh               # check now (always prints the list)
#   ./check-upstream.sh --install     # check every Monday at 09:00 (launchd)
#   ./check-upstream.sh --uninstall   # stop the weekly check
#
# Upstream is fetched into refs/upstream/main, so the working tree, branches
# and FETCH_HEAD are left alone. A notification is sent only when upstream
# has commits that an earlier check hasn't already reported; the full list
# goes to ~/.cumora/upstream-check.log every time.
#
# It also warns when the newest backup is CUMORA_BACKUP_MAX_AGE_DAYS (default
# 3) days old or more — the one failure backup.sh can't report itself: the
# daily job not running at all.
set -eu
cd "$(dirname "$0")"
here=$(pwd)
repo=$(cd ../.. && pwd)

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PATH

upstream_url=${CUMORA_UPSTREAM_URL:-https://github.com/yetone/cumora}
branch=${CUMORA_UPSTREAM_BRANCH:-zh-tw}
label=ai.cumora.upstream-check
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/.cumora/upstream-check.log"
seen="$HOME/.cumora/upstream-last-notified"

case "${1:-}" in
  --install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.cumora"
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>$here/check-upstream.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$here</string>
  <key>StartCalendarInterval</key><dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>9</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict></plist>
PLIST
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load "$plist"
    echo "已設定每週一 09:00 檢查上游更新（Mac 當時在睡眠的話，醒來後補跑）。"
    echo "日誌：$log"
    exit 0
    ;;
  --uninstall)
    launchctl unload "$plist" 2>/dev/null || true
    rm -f "$plist"
    echo "已取消每週檢查上游更新。"
    exit 0
    ;;
  '') ;;
  *) echo "用法：./check-upstream.sh [--install | --uninstall]" >&2; exit 64 ;;
esac

stamp() { date '+%Y-%m-%d %H:%M:%S'; }
notify() {
  # Title and body are fixed text plus numbers, so no quoting surprises.
  osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true
}

# While we're up anyway: a backup job that stopped running altogether (unloaded,
# Mac off for days) reports no failure, so check that the newest backup is
# recent. Only when the daily backup is installed; runs before the fetch so a
# network failure can't skip it.
backup_plist="$HOME/Library/LaunchAgents/ai.cumora.backup.plist"
if [ -f "$backup_plist" ]; then
  backup_dir=$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:CUMORA_BACKUP_DIR" "$backup_plist" 2>/dev/null || true)
  newest=$(for d in "${backup_dir:-$HOME/.cumora/backups}" "$HOME/.cumora/backups"; do
    for b in "$d"/cumora-*; do [ -f "$b/db.sql.gz" ] && basename "$b"; done
  done | sort | tail -n 1)
  max_days=${CUMORA_BACKUP_MAX_AGE_DAYS:-3}
  # Run by launchd, macOS (TCC) won't let this job list ~/Downloads or a
  # Google Drive folder (only the backup job itself is allowed). Then go by
  # the backup job's own log: its last "備份完成" line.
  if [ -n "$backup_dir" ] && [ -d "$backup_dir" ] && ! ls "$backup_dir" >/dev/null 2>&1; then
    newest=$(sed -n 's#.*備份完成：.*/\(cumora-[0-9]\{8\}-[0-9]\{6\}\)（.*#\1#p' "$HOME/.cumora/backup.log" 2>/dev/null | tail -n 1)
  fi
  if [ -z "$newest" ]; then
    echo "$(stamp) 警告：找不到任何備份" >&2
    notify "Cumora 沒有備份" "找不到任何備份。跑一次 ./backup.sh 看看"
  else
    taken=$(date -j -f %Y%m%d-%H%M%S "${newest#cumora-}" +%s 2>/dev/null || echo 0)
    age_days=$(( ($(date +%s) - taken) / 86400 ))
    if [ "$age_days" -ge "$max_days" ]; then
      echo "$(stamp) 警告：最新的備份是 $age_days 天前（$newest）" >&2
      notify "Cumora 備份太久沒更新" "最新的備份是 $age_days 天前。每日備份可能沒在跑，詳情：~/.cumora/backup.log"
    fi
  fi
fi

git -C "$repo" fetch --quiet "$upstream_url" "+main:refs/upstream/main" \
  || { echo "$(stamp) 檢查失敗：抓不到 $upstream_url（網路？）" >&2; exit 1; }
git -C "$repo" rev-parse --verify --quiet "$branch" >/dev/null \
  || { echo "$(stamp) 檢查失敗：找不到分支 $branch" >&2; exit 1; }

range="$branch..refs/upstream/main"
count=$(git -C "$repo" rev-list --count --no-merges "$range")
if [ "$count" -eq 0 ]; then
  echo "$(stamp) 上游沒有新的 commit（$branch 已是最新）"
  exit 0
fi

security=$(git -C "$repo" log --no-merges --format='%s' "$range" | grep -ciE 'security|cve|vuln' || true)
head_sha=$(git -C "$repo" rev-parse refs/upstream/main)

echo "$(stamp) $branch 落後上游 $count 個 commit（安全相關 $security 個）："
git -C "$repo" log --no-merges --format='  %h %s' "$range"

if [ "$(cat "$seen" 2>/dev/null || true)" = "$head_sha" ]; then
  echo "  （上次已通知過同一批，這次不再通知）"
  exit 0
fi
body="$branch 落後 $count 個 commit"
[ "$security" -gt 0 ] && body="$body，其中 $security 個安全相關"
notify "Cumora 上游有更新" "$body。詳情：~/.cumora/upstream-check.log"
mkdir -p "$(dirname "$seen")"
echo "$head_sha" > "$seen"
