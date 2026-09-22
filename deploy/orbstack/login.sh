#!/bin/sh
# Sign in to this self-hosted Cumora from this Mac — no OAuth app needed.
#
#   ./login.sh                 # first address in CUMORA_ADMIN_EMAILS
#   ./login.sh you@example.com "Display Name"
#
# The first run creates the account and its workspace. The sign-in URL carries
# a session token, so it goes straight to the browser and is never printed.
set -eu
cd "$(dirname "$0")"

email=${1:-$(sed -n 's/^CUMORA_ADMIN_EMAILS=//p' .env | cut -d, -f1 | tr -d ' ')}
if [ -z "$email" ]; then
  echo "用法：./login.sh <email> [顯示名稱]（或在 .env 設定 CUMORA_ADMIN_EMAILS）" >&2
  exit 1
fi

set -- login --email "$email" ${2:+--name "$2"}
# Keep only the last stdout line and check its shape: the value holds a session
# token, so nothing below may echo it — not even on failure.
url=$(docker compose exec -T server node_modules/.bin/tsx server/src/local-login-bin.ts "$@" | tail -n 1)
case "$url" in
  http://*'#token='*|https://*'#token='*) ;;
  *) echo "登入失敗：沒有拿到登入網址（詳見上方訊息）。" >&2; exit 1 ;;
esac
if ! open "$url" >/dev/null 2>&1; then
  echo "登入失敗：無法開啟瀏覽器。" >&2
  exit 1
fi
echo "已在預設瀏覽器以 $email 登入。"
