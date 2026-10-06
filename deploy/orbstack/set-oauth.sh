#!/bin/sh
# Write the GitHub OAuth app credentials and the admin email into .env.
# Prompts in the terminal (the secret is not echoed), so the values never pass
# through an editor or a chat transcript. Run ./up.sh afterwards.
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  # Same guard as up.sh: a fresh .env over an existing database would get new
  # secrets on the next ./up.sh and lock the database and paired computers out.
  if docker volume inspect cumora_pgdata >/dev/null 2>&1; then
    echo "找不到 .env，但資料庫已經存在。先跑 ./restore.sh 從備份放回 .env，再設定 GitHub 登入。" >&2
    exit 1
  fi
  cp .env.example .env
fi
current_admins=$(sed -n 's/^CUMORA_ADMIN_EMAILS=//p' .env)

printf 'GitHub OAuth App Client ID: '
read -r client_id
printf 'GitHub OAuth App Client secret（輸入時不會顯示）: '
# Turn echo back on even if the prompt is interrupted with Ctrl-C.
trap 'stty echo 2>/dev/null || true' EXIT INT TERM
stty -echo 2>/dev/null || true; read -r client_secret; stty echo 2>/dev/null || true; echo
if [ -n "$current_admins" ]; then
  printf '管理員 email（直接按 Enter 保留 %s）: ' "$current_admins"
else
  printf '管理員 email（你 GitHub 帳號的 email）: '
fi
read -r admin_emails
admin_emails=${admin_emails:-$current_admins}

if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
  echo "Client ID 和 secret 都要填。" >&2
  exit 1
fi

# awk + ENVIRON so no character in a value can break the substitution.
tmp=$(mktemp .env.XXXXXX)
GITHUB_CLIENT_ID="$client_id" GITHUB_CLIENT_SECRET="$client_secret" CUMORA_ADMIN_EMAILS="$admin_emails" \
awk '
  BEGIN { split("GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET CUMORA_ADMIN_EMAILS", keys, " ") }
  {
    for (i in keys) {
      k = keys[i]
      if (index($0, k "=") == 1) { print k "=" ENVIRON[k]; seen[k] = 1; next }
    }
    print
  }
  END { for (i in keys) { k = keys[i]; if (!(k in seen)) print k "=" ENVIRON[k] } }
' .env > "$tmp"
chmod 600 "$tmp"
mv "$tmp" .env
echo "已寫入 .env。接著執行 ./up.sh 重啟。"
