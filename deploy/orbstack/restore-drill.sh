#!/bin/sh
# Restore drill: prove a backup really comes back, without touching the real
# Cumora. Restores into a throwaway compose project, checks it, deletes it.
#
#   ./restore-drill.sh                 # the newest off-site copy (or, without
#                                      # one, the newest local backup)
#   ./restore-drill.sh <backup>        # a backup folder or .tar.xz(.enc)
#
# The daily backup (backup.sh) runs it by itself on the copy it just wrote,
# once the last passing drill is CUMORA_BACKUP_DRILL_DAYS (default 30) days
# old. It is not a launchd job of its own on purpose: under launchd macOS
# (TCC) refuses to list ~/Downloads or a Google Drive folder, or to read files
# there the job did not create; the backup job can read what it just wrote.
#
# It plays the worst case: no .env, only the backup. The throwaway project
# (cumora-drill, port 5192) starts from the backup's own env, then .env is
# removed and ./restore.sh is run on the backup exactly as you would, so it
# exercises the unpacking, .env recovery and restore paths too. Then it checks:
#   - .env came back byte for byte
#   - every table has the row count of the dump (realtime_outbox excepted: the
#     server prunes published events past their retention right after boot)
#   - every uploaded file has the backup's checksum
#   - the server answers /api/health and has at least one account
# The result goes to ~/.cumora/restore-drill.last (shown by ./doctor.sh) and
# a macOS notification; run by backup.sh, its output goes to ~/.cumora/backup.log.
#
#   CUMORA_DRILL_PORT   port of the throwaway server (default 5192)
set -eu
cd "$(dirname "$0")"
here=$(pwd)

PATH="$HOME/.orbstack/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

project=cumora-drill
port=${CUMORA_DRILL_PORT:-5192}
volatile_tables="realtime_outbox"
backup_plist="$HOME/Library/LaunchAgents/ai.cumora.backup.plist"
last="$HOME/.cumora/restore-drill.last"
. "$here/offsite-crypto.sh"

stamp() { date '+%Y-%m-%d %H:%M:%S'; }
notify() {
  t=$(printf '%s' "$1" | tr -d '"\\')
  b=$(printf '%s' "$2" | tr -d '"\\')
  osascript -e "display notification \"$b\" with title \"$t\"" >/dev/null 2>&1 || true
}
recorded=
record() { mkdir -p "$HOME/.cumora"; printf '%s\t%s\t%s\n' "$1" "$(date +%s)" "$2" > "$last"; recorded=1; }
fail() {
  echo "$(stamp) 還原演練失敗：$*" >&2
  record fail "$*"
  notify "Cumora 還原演練失敗" "$*。詳情：~/.cumora/backup.log"
  exit 1
}
plist_env() { [ -f "$1" ] && /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$2" "$1" 2>/dev/null || true; }

case "${1:-}" in
  -*) echo "用法：./restore-drill.sh [備份資料夾 | 異地副本.tar.xz(.enc)]" >&2; exit 64 ;;
esac

# Which backup: the argument, else the newest off-site copy (what a dead disk
# would leave you with), else the newest local backup folder.
#
# Under a launchd job macOS (TCC) may refuse to list ~/Downloads or a Google
# Drive folder. Say so, rather than quietly drilling an older backup from
# somewhere else.
offsite_dir=$(plist_env "$backup_plist" CUMORA_BACKUP_OFFSITE_DIR)
local_dir=$(plist_env "$backup_plist" CUMORA_BACKUP_DIR)
local_dir=${local_dir:-$HOME/.cumora/backups}
check_readable() {
  [ ! -d "$1" ] || ls "$1" >/dev/null 2>&1 \
    || fail "macOS 不讓這個程序讀 $1（由每日備份順便跑，或從終端機跑 ./restore-drill.sh）"
}
newest_offsite() {
  [ -n "$offsite_dir" ] || return 0
  (cd "$offsite_dir" 2>/dev/null && ls -1 cumora-*.tar.xz cumora-*.tar.xz.enc 2>/dev/null) | sort | tail -n 1 | sed "s#^#$offsite_dir/#"
}
newest_local() {
  for dir in "$local_dir" "$HOME/.cumora/backups"; do
    for b in "$dir"/cumora-*; do [ -f "$b/db.sql.gz" ] && printf '%s\t%s\n' "$(basename "$b")" "$b"; done
  done | sort | tail -n 1 | cut -f2
}
source=${1:-}
if [ -z "$source" ]; then
  [ -z "$offsite_dir" ] || check_readable "$offsite_dir"
  check_readable "$local_dir"
  source=$(newest_offsite)
  [ -n "$source" ] || source=$(newest_local)
fi
[ -n "$source" ] || fail "找不到任何備份"
source=${source%/}
[ -e "$source" ] || fail "找不到 $source"
echo "$(stamp) 還原演練開始：$source"

docker info >/dev/null 2>&1 || fail "Docker 沒有回應（OrbStack 沒開？）"
docker image inspect cumora-server:zh-tw >/dev/null 2>&1 || fail "沒有 cumora-server:zh-tw 映像（先跑 ./up.sh）"

mkdir -p "$HOME/.cumora"
scratch=$(mktemp -d "$HOME/.cumora/drill-XXXXXX")
chmod 700 "$scratch"
dc() { (cd "$scratch" && COMPOSE_PROJECT_NAME=$project docker compose "$@"); }
# Any exit that did not go through fail() or the final record (set -e) still
# has to show up as a failed drill, or doctor.sh would keep the last verdict.
cleanup() {
  rc=$?
  dc down -v >/dev/null 2>&1 || true
  rm -rf "$scratch"
  if [ -z "$recorded" ]; then
    echo "$(stamp) 還原演練意外中斷（結束碼 $rc）" >&2
    record fail "意外中斷（結束碼 $rc），看 ~/.cumora/backup.log"
    notify "Cumora 還原演練失敗" "意外中斷，詳情：~/.cumora/backup.log"
  fi
}
trap cleanup EXIT
cp docker-compose.yml backup.sh restore.sh offsite-crypto.sh "$scratch/"
dc down -v >/dev/null 2>&1 || true   # leftovers of a drill that was killed
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then fail "port $port 已被占用（用 CUMORA_DRILL_PORT 換一個）"; fi

# Our own unpacked copy, to compare against. restore.sh unpacks its own.
expect="$scratch/expect"
mkdir -m 700 "$expect"
case "$source" in
  *.tar.xz.enc) offsite_decrypt < "$source" | tar -C "$expect" -xJf - || fail "解不開 $source（鑰匙圈密碼？）"
                bk="$expect/$(basename "$source" .tar.xz.enc)" ;;
  *.tar.xz) tar -C "$expect" -xJf "$source" || fail "解不開 $source（檔案損壞？）"
            bk="$expect/$(basename "$source" .tar.xz)" ;;
  *) bk=$source ;;
esac
for f in db.sql.gz uploads.tar.gz env; do [ -f "$bk/$f" ] || fail "備份裡沒有 $f"; done

# Bring the throwaway project up from the backup's env, then drop .env.
(umask 077 && cat "$bk/env" > "$scratch/.env") || fail "讀不了 $bk/env（macOS 權限？）"
echo "CUMORA_PORT=$port" >> "$scratch/.env"
dc up -d --no-build >/dev/null 2>&1 || fail "拋棄式專案起不來（docker compose up）"
rm "$scratch/.env"

echo restore | COMPOSE_PROJECT_NAME=$project CUMORA_PRE_RESTORE_DIR="$scratch/pre-restore" \
  CUMORA_BACKUP_DIR="$scratch/backups" "$scratch/restore.sh" "$source" \
  || fail "restore.sh 失敗"

# 1. .env
cmp -s "$scratch/.env" "$bk/env" || fail "還原出來的 .env 跟備份不同"

# 2. Row counts: the dump's COPY blocks vs the restored tables.
tab=$(printf '\t')
gunzip -c "$bk/db.sql.gz" \
  | awk '/^COPY /{t=$2; n=0; inb=1; next} inb && /^\\\.$/{print t"\t"n; inb=0; next} inb{n++}' \
  | sed 's/^public\.//' | LC_ALL=C sort > "$scratch/expected.tsv"
dc exec -T postgres psql -U cumora -d cumora -AtF "$tab" -v ON_ERROR_STOP=1 -c "
  select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'" \
  > "$scratch/actual.raw" || fail "數不了還原後的資料表"
LC_ALL=C sort "$scratch/actual.raw" > "$scratch/actual.tsv"
tables=$(wc -l < "$scratch/expected.tsv" | tr -d ' ')
[ "$tables" -gt 0 ] || fail "備份的資料庫裡沒有任何資料表"
mismatch=$(LC_ALL=C join -t "$tab" -a 1 -e missing -o 0,1.2,2.2 "$scratch/expected.tsv" "$scratch/actual.tsv" \
  | awk -F '\t' -v skip=" $volatile_tables " 'index(skip, " " $1 " ") == 0 && $2 != $3 { printf "%s%s(%s→%s)", sep, $1, $2, $3; sep=" " }')
[ -z "$mismatch" ] || fail "資料筆數不符：$mismatch"
rows=$(awk -F '\t' '{ s += $2 } END { print s + 0 }' "$scratch/expected.tsv")

# 3. Uploads, file by file.
mkdir "$expect/uploads" && tar -C "$expect/uploads" -xzf "$bk/uploads.tar.gz" || fail "解不開 uploads.tar.gz"
(cd "$expect/uploads" && find . -type f -exec shasum {} + | awk '{ print $1, $2 }' | sort -k2) > "$scratch/up-expected.txt"
docker run --rm -v "${project}_uploads:/data:ro" --entrypoint sh pgvector/pgvector:pg16 \
  -c 'cd /data && find . -type f -exec sha1sum {} + | sort -k2' | awk '{ print $1, $2 }' > "$scratch/up-actual.txt" \
  || fail "讀不了還原後的上傳檔案"
cmp -s "$scratch/up-expected.txt" "$scratch/up-actual.txt" || fail "上傳檔案跟備份不同"
files=$(wc -l < "$scratch/up-expected.txt" | tr -d ' ')

# 4. The server works and has accounts.
curl -fsS -o /dev/null "http://127.0.0.1:$port/api/health" || fail "還原後的伺服器沒有回應 /api/health"
users=$(dc exec -T postgres psql -U cumora -d cumora -Atc 'select count(*) from users') || fail "查不到帳號"
[ "$users" -gt 0 ] || fail "還原後一個帳號都沒有"

summary="$(basename "$source")：$tables 張表 $rows 筆、$files 個上傳檔案、$users 個帳號都對得上"
echo "$(stamp) 還原演練通過：$summary"
record ok "$summary"
notify "Cumora 還原演練通過" "$summary"
