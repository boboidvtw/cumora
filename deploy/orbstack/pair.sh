#!/bin/sh
# Pair this Mac as a BYOA computer for your workspace and install the daemon as
# a launchd service (auto-start at login, auto-restart, auto-update).
#
#   ./pair.sh                  # workspace of the first CUMORA_ADMIN_EMAILS address
#   ./pair.sh you@example.com
#   CUMORA_ENGINE=codex ./pair.sh
#
# Run ./login.sh once first so the account and workspace exist. The pairing
# token is handed straight to the daemon and never printed.
set -eu
cd "$(dirname "$0")"

email=${1:-$(sed -n 's/^CUMORA_ADMIN_EMAILS=//p' .env | cut -d, -f1 | tr -d ' ')}
if [ -z "$email" ]; then
  echo "用法：./pair.sh <email>（或在 .env 設定 CUMORA_ADMIN_EMAILS）" >&2
  exit 1
fi
origin=$(sed -n 's/^CUMORA_PUBLIC_ORIGIN=//p' .env)
origin=${origin:-http://localhost:5181}
engine=${CUMORA_ENGINE:-claude}

# Last stdout line only, and it must look like a token — never echo it.
code=$(docker compose exec -T server node_modules/.bin/tsx server/src/local-login-bin.ts pair-code --email "$email" | tail -n 1)
case "$code" in
  ''|*[!A-Za-z0-9_-]*) echo "配對失敗：沒有拿到配對碼（先執行 ./login.sh 建立帳號）。" >&2; exit 1 ;;
esac
# One invocation: pair (saves ~/.cumora/computer.json), then hand off to the
# launchd supervisor and return instead of running in the foreground.
npx -y cumora@latest agent computer --pair "$code" --server "$origin" --engine "$engine" --install-service
echo "這台 Mac 已配對，常駐程式已註冊為背景服務（日誌：~/.cumora/daemon.log）。"
