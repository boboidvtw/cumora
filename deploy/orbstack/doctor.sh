#!/bin/sh
# One-stop health check for self-hosted Cumora. Read-only: it changes nothing
# and never prints a secret.
#
#   ./doctor.sh
#
# ✓ fine · ! worth a look · ✗ broken. Exits 1 when anything is ✗.
set -u
cd "$(dirname "$0")" || exit 1

PATH="$HOME/.orbstack/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

broken=0
warnings=0
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; warnings=$((warnings + 1)); }
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

# Agents whose latest run failed and that haven't replied since. The daemon
# can be up and connected while every turn dies on an expired engine login.
# A failure on an engine the agent has since been moved off is not counted.
if [ -n "$(docker compose ps -q postgres 2>/dev/null)" ]; then
  if stuck=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtF "	" -v ON_ERROR_STOP=1' 2>/dev/null <<'SQL'
with failed as (
  select distinct on (author_id) author_id, created_at, body::json->>'text' as text,
         substring(body::json->>'text' from 'could not run on local ([A-Za-z0-9_-]+):') as engine
  from messages
  where kind = 'system' and body like '%"noticeKind":"byoa_engine_failed"%'
  order by author_id, created_at desc
), replied as (
  select author_id, max(created_at) as at from messages where kind = 'text' group by author_id
)
select coalesce(p.name, f.author_id), extract(epoch from f.created_at)::bigint,
       coalesce(nullif(split_part(f.text, E'\n', 2), ''), split_part(f.text, E'\n', 1)),
       coalesce(f.engine, '')
from failed f
left join replied r using (author_id)
left join participants p on p.id = f.author_id
where (r.at is null or f.created_at > r.at)
  and (f.engine is null or p.engine is null or p.engine_inherit or p.engine = f.engine)
order by 1;
SQL
  ); then
    if [ -z "$stuck" ]; then
      ok "智能體最近沒有執行失敗"
    else
      # One line per distinct engine + reason: newest failure time, names.
      grouped=$(printf '%s\n' "$stuck" | awk -F '\t' '{ k = $4 "\t" $3; n[k] = n[k] (n[k] ? "、" : "") $1; if ($2 > t[k]) t[k] = $2 }
        END { for (k in n) printf "%s\t%s\t%s\n", t[k], n[k], k }')
      tab=$(printf '\t')
      while IFS="$tab" read -r at names engine reason; do
        bad "$names 跑不起來（${engine:+$engine 引擎，}最後一次 $(date -r "$at" '+%m/%d %H:%M')）：$reason"
        case "$reason" in
          *uthenticat*|*OAuth*|*login*|*"log in"*)
            case "$engine" in
              codex) printf '    → 在這台 Mac 的終端機執行 codex login 重新登入，再到對話裡叫它一次\n' ;;
              antigravity) printf '    → 在這台 Mac 的終端機執行 agy 重新登入，再到對話裡叫它一次\n' ;;
              claude|'') printf '    → 在這台 Mac 的終端機執行 claude，輸入 /login 重新登入，再到對話裡叫它一次\n' ;;
              *) printf '    → 在這台 Mac 重新登入 %s，再到對話裡叫它一次\n' "$engine" ;;
            esac ;;
          *quota*|*credit*|*"rate limit"*|*"usage limit"*)
            printf '    → 額度用完了：等額度恢復或加值，再到對話裡叫它一次\n' ;;
        esac
      done <<GROUPED
$grouped
GROUPED
    fi
  else
    warn "查不到智能體的執行紀錄（資料庫沒有回應？）"
  fi
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
  else warn "LM Studio 沒有回應（lms server start）：智能體不會主動接看板上的工作，頭像改用名字決定外觀；聊天不受影響"; fi
else
  case "$models" in
    *"\"$model\""*) ok "LM Studio 有回應，有模型 $model" ;;
    *) warn "LM Studio 有回應，但沒有模型 $model" ;;
  esac
fi
# The server's own small LLM calls (agenda check, triage, routing) are in the
# ledger; agent-turn rows are the agents themselves, checked above.
server_llm=$(sed -n 's/^SERVER_LLM=//p' .env 2>/dev/null)
server_llm=${server_llm:-local}
if calls=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtF "	" -v ON_ERROR_STOP=1' 2>/dev/null <<'SQL'
SELECT count(*),
       count(*) FILTER (WHERE status <> 'ok'),
       coalesce(string_agg(DISTINCT purpose, '、') FILTER (WHERE status <> 'ok'), ''),
       coalesce(extract(epoch from max(created_at) FILTER (WHERE status <> 'ok'))::bigint::text, ''),
       coalesce((array_agg(model ORDER BY created_at DESC) FILTER (WHERE status <> 'ok'))[1], ''),
       coalesce(left(regexp_replace((array_agg(error ORDER BY created_at DESC) FILTER (WHERE status <> 'ok'))[1], '\s+', ' ', 'g'), 120), '')
  FROM llm_calls
 WHERE purpose <> 'agent-turn' AND created_at > now() - interval '24 hours'
SQL
); then
  IFS='	' read -r total failed purposes last_at last_model last_error <<EOF2
$calls
EOF2
  where="LM Studio"; [ "$server_llm" = local ] || where=OpenAI
  if [ "${failed:-0}" -gt 0 ]; then
    warn "伺服器端的小型判斷最近 24 小時失敗 $failed／$total 次（$purposes；最後一次 $(date -r "$last_at" '+%m/%d %H:%M')，模型 $last_model）：$last_error"
  elif [ "${total:-0}" -gt 0 ]; then
    ok "伺服器端的小型判斷（$where）最近 24 小時 $total 次都成功"
  else
    ok "伺服器端的小型判斷用 $where（最近 24 小時沒有需要判斷的事）"
  fi
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
  offsite=$(plist_env "$backup_plist" CUMORA_BACKUP_OFFSITE_DIR)
  if [ -n "$offsite" ]; then
    latest=$( (cd "$offsite" 2>/dev/null && ls -1 cumora-*.tar.xz cumora-*.tar.xz.enc 2>/dev/null) | sort | tail -n 1)
    if [ -z "$latest" ]; then
      warn "已設定異地副本（$offsite），但還沒有任何一份（下次 03:30 會產生，或先跑 ./backup.sh）"
    else
      taken=$(date -j -f %Y%m%d-%H%M%S "$(printf '%s' "$latest" | sed -E 's/^cumora-//; s/\.tar\.xz(\.enc)?$//')" +%s 2>/dev/null || echo 0)
      age=$(( ($(date +%s) - taken) / 3600 ))
      if [ "$age" -lt 48 ]; then ok "異地副本 $age 小時前：$offsite/$latest"
      else warn "異地副本是 $(( age / 24 )) 天前：$offsite/$latest（看 ~/.cumora/backup.log）"; fi
    fi
    if [ "$(plist_env "$backup_plist" CUMORA_BACKUP_OFFSITE_ENCRYPT)" != 0 ]; then
      security find-generic-password -s cumora-backup -a "$(id -un)" >/dev/null 2>&1 \
        || bad "鑰匙圈裡沒有 cumora-backup 加密密碼，異地副本會做不出來"
    fi
  else
    case "$dir" in
      "$HOME"/Downloads/*|"$HOME"/.cumora/*) warn "備份跟資料在同一顆硬碟（$dir），防不了硬碟壞掉（設定 CUMORA_BACKUP_OFFSITE_DIR，見 README）" ;;
    esac
  fi
fi

# Restore drill (restore-drill.sh): a backup nobody has restored is a hope.
drill_last="$HOME/.cumora/restore-drill.last"
if [ -f "$drill_last" ]; then
  IFS="$(printf '\t')" read -r drill_result drill_at drill_note < "$drill_last" || true
  drill_days=$(( ($(date +%s) - ${drill_at:-0}) / 86400 ))
  drill_when=$(date -r "${drill_at:-0}" '+%m/%d')
  if [ "$drill_result" != ok ]; then
    bad "上次還原演練失敗（$drill_when）：$drill_note"
    printf '    → 看 ~/.cumora/backup.log，修好後跑 ./restore-drill.sh\n'
  elif [ "$drill_days" -le 45 ]; then ok "還原演練通過（$drill_when）：$drill_note"
  else warn "上次還原演練是 $drill_days 天前（$drill_when），跑一次 ./restore-drill.sh"; fi
fi
if [ -f "$backup_plist" ] && [ "$(plist_env "$backup_plist" CUMORA_BACKUP_DRILL_DAYS)" = 0 ]; then
  warn "每日備份不會順便做還原演練（CUMORA_BACKUP_DRILL_DAYS=0）"
elif [ ! -f "$drill_last" ]; then
  warn "還沒做過還原演練（./restore-drill.sh，或等每日備份順便跑）"
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

# GitHub CI for zh-tw. Optional: skipped quietly without gh, a login or network.
remote=$(git -C "$repo" remote get-url origin 2>/dev/null | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')
if command -v gh >/dev/null 2>&1 && [ -n "$remote" ]; then
  ci=$(gh run list --repo "$remote" --workflow pr.yml --branch zh-tw --limit 1 \
    --json status,conclusion,headSha,url --jq '.[0] | "\(.status) \(.conclusion | if . == "" or . == null then "-" else . end) \(.headSha[0:7]) \(.url)"' 2>/dev/null || true)
  head=$(git -C "$repo" rev-parse --short=7 zh-tw 2>/dev/null)
  set -- $ci
  case "${1:-}" in
    completed)
      if [ "$2" = success ]; then ok "GitHub CI 通過（$3）"; else bad "GitHub CI 結果是 $2（$3）：$4"; fi
      [ "$3" = "$head" ] || warn "最新的 CI 跑的是 $3，不是目前的 zh-tw（$head）；推上去了嗎？"
      ;;
    '') ;;
    *) ok "GitHub CI 正在跑（$3）：$4" ;;
  esac
fi

echo
if [ "$broken" != 0 ]; then echo "有項目要處理（✗）。"
elif [ "$warnings" != 0 ]; then echo "沒有壞掉的項目，有 $warnings 個提醒（!）值得看一下。"
else echo "沒有發現問題。"; fi
exit "$broken"
