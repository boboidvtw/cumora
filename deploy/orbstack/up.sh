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
  echo "警告：.env 還沒填$missing —— 服務會啟動，但登入頁不會出現 GitHub 登入按鈕。" >&2
fi

docker compose build
docker compose up -d --wait server

port=$(sed -n 's/^CUMORA_PORT=//p' .env)
echo ""
echo "Cumora 已啟動：http://localhost:${port:-5181}"
