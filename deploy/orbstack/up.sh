#!/bin/sh
# Build and start self-hosted Cumora on OrbStack (Docker Compose).
# Safe to re-run: rebuilds the image, applies pending migrations, restarts the server.
set -eu
cd "$(dirname "$0")"

if ! docker info >/dev/null 2>&1; then
  echo "Docker 沒有回應 —— 請先開啟 OrbStack。" >&2
  exit 1
fi

if [ ! -f .env ]; then
  # An existing database already has the old POSTGRES_PASSWORD and paired
  # computers the old AGENT_RUNTIME_SECRET; fresh secrets would lock both out.
  if docker volume inspect cumora_pgdata >/dev/null 2>&1; then
    echo "找不到 .env，但資料庫已經存在。重新產生的密鑰會連不上它，所以不建立新的 .env。" >&2
    echo "請先跑 ./restore.sh：它會從最新的備份放回 .env（之後確認時取消，就只還原 .env）。" >&2
    exit 1
  fi
  cp .env.example .env
  echo "已從 .env.example 建立 .env"
fi

# Fill a KEY= line in .env with a random secret, once. Never overwrite an
# existing value: POSTGRES_PASSWORD is baked into the database volume and
# AGENT_RUNTIME_SECRET signs every paired computer's token.
fill_secret() {
  key=$1
  if grep -q "^${key}=\$" .env; then
    value=$(openssl rand -hex 32)
    sed -i '' "s/^${key}=\$/${key}=${value}/" .env
    echo "已產生 ${key}"
  fi
}
fill_secret POSTGRES_PASSWORD
fill_secret AGENT_RUNTIME_SECRET

missing=""
for key in GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET; do
  grep -q "^${key}=..*" .env || missing="$missing $key"
done
if [ -n "$missing" ]; then
  echo "提示：.env 沒有設定$missing，登入頁的 GitHub 登入不能用；在這台 Mac 上請改用 ./login.sh 登入。" >&2
fi

docker compose build
docker compose up -d --wait server

port=$(sed -n 's/^CUMORA_PORT=//p' .env)
echo ""
echo "Cumora 已啟動：http://localhost:${port:-5181}"
