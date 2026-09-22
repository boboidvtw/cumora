#!/bin/sh
# Write the GitHub OAuth app credentials and the admin email into .env.
# Prompts in the terminal (the secret is not echoed), so the values never pass
# through an editor or a chat transcript. Run ./up.sh afterwards.
set -eu
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env

printf 'GitHub OAuth App Client ID: '
read -r client_id
printf 'GitHub OAuth App Client secret（輸入時不會顯示）: '
stty -echo 2>/dev/null || true; read -r client_secret; stty echo 2>/dev/null || true; echo
printf '管理員 email（你 GitHub 帳號的 email）: '
read -r admin_emails

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
