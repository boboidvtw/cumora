#!/bin/sh
# Pin the reply language of every agent in the workspace (default: Traditional
# Chinese, Taiwan wording). Re-run after adding agents; it rewrites only the
# language block inside each persona, so it is safe to repeat.
#
#   ./set-language.sh
#   ./set-language.sh you@example.com "語言：一律用英文回覆。"
set -eu
cd "$(dirname "$0")"

email=${1:-$(sed -n 's/^CUMORA_ADMIN_EMAILS=//p' .env | cut -d, -f1 | tr -d ' ')}
if [ -z "$email" ]; then
  echo "用法：./set-language.sh <email> [語言規則]（或在 .env 設定 CUMORA_ADMIN_EMAILS）" >&2
  exit 1
fi

set -- set-language --email "$email" ${2:+--language "$2"}
docker compose exec -T server node_modules/.bin/tsx server/src/local-login-bin.ts "$@" >/dev/null
echo "已更新人設語言。執行 npx cumora@latest agent computer --restart 讓它立即生效。"
