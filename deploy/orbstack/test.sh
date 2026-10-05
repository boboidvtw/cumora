#!/bin/sh
# Run the test suite against throwaway Postgres + Redis (test-services.yml).
#
#   ./test.sh                 # unit tests (npm test)
#   ./test.sh --integration   # unit tests, then the integration suite
#   ./test.sh --down          # stop and remove the test services
#
# DATABASE_URL and REDIS_URL are always set explicitly. Without them the
# server's env defaults point at localhost:5432 / localhost:6379, which on
# this Mac belong to other containers — tests would write into those.
set -eu
cd "$(dirname "$0")"

pg_port=${CUMORA_TEST_PG_PORT:-55432}
redis_port=${CUMORA_TEST_REDIS_PORT:-56379}
compose="docker compose -f test-services.yml"

if ! docker info >/dev/null 2>&1; then
  echo "Docker 沒有回應 —— 請先開啟 OrbStack（orb start）。" >&2
  exit 1
fi

if [ "${1:-}" = "--down" ]; then
  $compose down
  exit 0
fi

integration=0
[ "${1:-}" = "--integration" ] && integration=1

$compose up -d --wait >/dev/null
# The integration suite TRUNCATEs every table it touches, so it gets its own
# database next to the one the unit tests use.
$compose exec -T postgres psql -U cumora -d cumora -qtAc \
  "SELECT 1 FROM pg_database WHERE datname = 'cumora_test'" | grep -q 1 \
  || $compose exec -T postgres createdb -U cumora cumora_test

repo=$(cd ../.. && pwd)
for w in email-gate r2-gate; do
  if [ ! -d "$repo/workers/$w/node_modules" ]; then
    echo "安裝 workers/$w 的相依套件…"
    npm install --prefix "$repo/workers/$w" >/dev/null
  fi
done

export DATABASE_URL="postgres://cumora:cumora-test@127.0.0.1:$pg_port/cumora"
export REDIS_URL="redis://127.0.0.1:$redis_port"
export OPENAI_API_KEY=${OPENAI_API_KEY:-sk-test}
# Node 26 warns that tsx's module.register() is deprecated (DEP0205) on every
# start. The schema verifier treats any stderr line as unreadable output, so
# that warning alone fails deployment-schema-recovery. CI runs Node 24, which
# doesn't print it. Only that one warning is silenced.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--disable-warning=DEP0205"

cd "$repo"
npm test
if [ "$integration" = 1 ]; then
  INTEGRATION_DATABASE_URL="postgres://cumora:cumora-test@127.0.0.1:$pg_port/cumora_test" \
    npm run test:integration
fi
