#!/bin/sh
# One-stop health check for self-hosted Cumora. Read-only: it changes nothing
# and never prints a secret.
#
#   ./doctor.sh
#
# ✓ fine · ! worth a look · ✗ broken. Exits 1 when anything is ✗.
set -u
cd "$(dirname "$0")"

PATH="$HOME/.orbstack/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

broken=0
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
bad()  { printf '  ✗ %s\n' "$*"; broken=1; }
section() { printf '\n%s\n' "$*"; }
plist_env() { /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$2" "$1" 2>/dev/null || true; }

section "設定"
if [ ! -s .env ]; then
  bad ".env 不見了（./restore.sh 可以從備份放回來）"
else
  perms=$(stat -f '%Lp' .env)
  [ "$perms" = 600 ] && ok ".env 存在，只有你能讀" || warn ".env 權限是 $perms，建議 chmod 600 .env"
  for key in POSTGRES_PASSWORD AGENT_RUNTIME_SECRET; do
    grep -q "^$key=..*" .env || bad ".env 的 $key 是空的"
  done
  grep -q "^CUMORA_ADMIN_EMAILS=..*" .env || warn ".env 沒有設定 CUMORA_ADMIN_EMAILS（./login.sh、./pair.sh 要用）"
fi
origin=$(sed -n 's/^CUMORA_PUBLIC_ORIGIN=//p' .env 2>/dev/null)
origin=${origin:-http://localhost:5181}

section "伺服器"
if ! docker info >/dev/null 2>&1; then
  bad "Docker 沒有回應（OrbStack 沒開？執行 orb start）"
else
  for svc in postgres redis server; do
    id=$(docker compose ps -q "$svc" 2>/dev/null)
    if [ -z "$id" ]; then bad "$svc 沒在執行（./up.sh）"; continue; fi
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
    [ "$health" = healthy ] && ok "$svc 正常" || bad "$svc 狀態：$health（docker compose logs $svc）"
  done
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$origin/api/health")
  [ "$code" = 200 ] && ok "$origin 有回應" || bad "$origin/api/health 回應 $code"
fi

section "常駐程式（智能體的大腦）"
local_plist="$HOME/Library/LaunchAgents/io.cumora.daemon.local.plist"
if [ -f "$local_plist" ]; then
  label=io.cumora.daemon.local
  ok "用這個 repo 建的常駐程式"
elif launchctl print "gui/$(id -u)/io.cumora.daemon" >/dev/null 2>&1; then
  label=io.cumora.daemon
  ok "用 npm 的官方常駐程式"
else
  label=
  bad "沒有安裝常駐程式（./pair.sh）"
fi
if [ -n "$label" ]; then
  if launchctl print "gui/$(id -u)/$label" 2>/dev/null | grep -q 'state = running'; then
    ok "正在執行"
  else
    bad "沒在執行（launchctl kickstart -k gui/$(id -u)/$label）"
  fi
  last=$(grep -E 'control-stream (connected|error)' "$HOME/.cumora/daemon.log" 2>/dev/null | tail -n 1)
  case "$last" in
    *connected*) ok "已連上伺服器" ;;
    *error*) bad "連不上伺服器：最後一筆是「${last#*control-stream }」" ;;
    *) warn "日誌裡還沒有連線紀錄（~/.cumora/daemon.log）" ;;
  esac
  [ -f "$HOME/.cumora/computer.json" ] || bad "這台 Mac 沒有配對紀錄（./pair.sh）"
fi

section "本機模型（LM Studio）"
lm=$(sed -n 's/^LOCAL_LLM_BASE_URL=//p' .env 2>/dev/null)
lm=${lm:-http://host.docker.internal:1234/v1}
lm_host=$(printf '%s' "$lm" | sed 's#host.docker.internal#127.0.0.1#')
model=$(sed -n 's/^LOCAL_LLM_MODEL=//p' .env 2>/dev/null)
model=${model:-qwen3.8-27b}
models=$(curl -s -m 5 "$lm_host/models" 2>/dev/null)
hermes_on=
[ -f "$local_plist" ] && [ -n "$(plist_env "$local_plist" CUMORA_HERMES_ACP_BIN)" ] && hermes_on=1
if [ -z "$models" ]; then
  if [ -n "$hermes_on" ]; then bad "LM Studio 沒有回應（lms server start）：Hermes 智能體不能回覆"
  else warn "LM Studio 沒有回應（lms server start）：頭像會改用名字決定外觀，其他不受影響"; fi
else
  case "$models" in
    *"\"$model\""*) ok "LM Studio 有回應，有模型 $model" ;;
    *) warn "LM Studio 有回應，但沒有模型 $model" ;;
  esac
fi
if [ -n "$hermes_on" ]; then
  image=$(plist_env "$local_plist" CUMORA_HERMES_IMAGE)
  image=${image:-nousresearch/hermes-agent:latest}
  docker image inspect "$image" >/dev/null 2>&1 && ok "Hermes 已啟用，映像 $image 在本機" || bad "Hermes 已啟用，但沒有映像 $image（docker pull $image）"
fi

section "備份"
backup_plist="$HOME/Library/LaunchAgents/ai.cumora.backup.plist"
if [ ! -f "$backup_plist" ]; then
  warn "沒有設定每日備份（./backup.sh --install）"
else
  dir=$(plist_env "$backup_plist" CUMORA_BACKUP_DIR)
  dir=${dir:-$HOME/.cumora/backups}
  newest=$(for d in "$dir" "$HOME/.cumora/backups"; do
    for b in "$d"/cumora-*; do [ -f "$b/db.sql.gz" ] && printf '%s\t%s\n' "$(basename "$b")" "$b"; done
  done | sort | tail -n 1 | cut -f2)
  if [ -z "$newest" ]; then
    bad "每日備份已設定（$dir），但一份備份都沒有（./backup.sh）"
  else
    taken=$(date -j -f %Y%m%d-%H%M%S "$(basename "$newest" | sed 's/^cumora-//')" +%s 2>/dev/null || echo 0)
    age=$(( ($(date +%s) - taken) / 3600 ))
    if [ "$age" -lt 48 ]; then ok "最新備份 $age 小時前：$newest"
    else warn "最新備份是 $(( age / 24 )) 天前：$newest（看 ~/.cumora/backup.log）"; fi
    [ -f "$newest/env" ] || warn "最新備份裡沒有 .env 的副本"
  fi
  case "$dir" in
    "$HOME"/Downloads/*|"$HOME"/.cumora/*) warn "備份跟資料在同一顆硬碟（$dir），防不了硬碟壞掉" ;;
  esac
fi

section "上游"
repo=$(cd ../.. && pwd)
if [ -f "$HOME/Library/LaunchAgents/ai.cumora.upstream-check.plist" ]; then
  ok "每週檢查上游已設定"
else
  warn "沒有設定每週檢查上游（./check-upstream.sh --install）"
fi
if git -C "$repo" rev-parse --verify --quiet refs/upstream/main >/dev/null; then
  behind=$(git -C "$repo" rev-list --count --no-merges zh-tw..refs/upstream/main 2>/dev/null || echo '?')
  [ "$behind" = 0 ] && ok "zh-tw 已包含上次抓到的上游" || warn "zh-tw 落後上次抓到的上游 $behind 個 commit（見 README「同步上游更新」）"
fi

echo
if [ "$broken" = 0 ]; then echo "沒有發現問題。"; else echo "有項目要處理（✗）。"; fi
exit "$broken"
