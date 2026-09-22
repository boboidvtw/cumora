#!/bin/sh
# Run the BYOA daemon from THIS repo instead of the published npm package, as a
# launchd service.
#
# Why: only a daemon built from this checkout honours CUMORA_AGENT_READ_PATHS
# (see server/src/agents/computer/engine.ts), which is what lets an agent read a
# real project tree instead of just its own home. The npm daemon has no such
# switch — its only widening knob is CUMORA_BYOA_ALLOW_UNSANDBOXED=1, which
# drops the whole sandbox.
#
# Trade-off: no auto-update. After pulling upstream changes, re-run this script.
# CUMORA_SUPERVISED is deliberately NOT set: it tells the daemon a clean exit
# relaunches on `cumora@latest`, which is false here — with it, a checkout
# daemon saw every npm release as an update and restarted itself whenever idle,
# forever, dropping each agent's warm engine session.
#
#   ./install-local-daemon.sh                      # reads ~/Projects
#   CUMORA_AGENT_READ_PATHS=~/code ./install-local-daemon.sh
#   ./install-local-daemon.sh --uninstall          # back to the npm daemon
#   ./install-local-daemon.sh --hermes             # also run Hermes agents (in containers)
set -eu
cd "$(dirname "$0")"
repo=$(cd ../.. && pwd)
label=io.cumora.daemon.local
plist="$HOME/Library/LaunchAgents/$label.plist"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl unload "$plist" 2>/dev/null || true
  rm -f "$plist"
  echo "已移除自建常駐程式。要回到官方版：npx cumora@latest agent computer --install-service"
  exit 0
fi

read_paths=${CUMORA_AGENT_READ_PATHS:-$HOME/Projects}
version=$(node -p "require('$repo/package.json').version")

# --hermes: let this daemon drive the Hermes engine through its container
# wrapper. Only Hermes is exempted from the sandbox requirement; Claude and
# Codex agents keep theirs.
hermes_env=
if [ "${1:-}" = "--hermes" ]; then
  hermes_bin="$(pwd)/hermes/hermes-acp-container"
  command -v docker >/dev/null 2>&1 || { echo "找不到 docker，Hermes 需要 OrbStack / Docker" >&2; exit 1; }
  hermes_env="    <key>CUMORA_BYOA_ALLOW_UNSANDBOXED</key><string>hermes</string>
    <key>CUMORA_HERMES_ACP_BIN</key><string>$hermes_bin</string>"
fi
origin=$(sed -n 's/^CUMORA_PUBLIC_ORIGIN=//p' .env)
origin=${origin:-http://localhost:5181}

if [ ! -d "$repo/node_modules" ]; then
  echo "先安裝相依套件：cd $repo && npm ci" >&2
  exit 1
fi
if [ ! -f "$HOME/.cumora/computer.json" ]; then
  echo "這台電腦還沒配對，先執行 ./pair.sh" >&2
  exit 1
fi

# One daemon per machine: the npm-installed service would race this one for the
# same agents, so stop it first.
npx -y cumora@latest agent computer --uninstall-service >/dev/null 2>&1 || true

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.cumora"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>$repo/bin/cumora</string>
    <string>agent</string>
    <string>computer</string>
    <string>--server</string>
    <string>$origin</string>
  </array>
  <key>WorkingDirectory</key><string>$repo</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.cumora/daemon.log</string>
  <key>StandardErrorPath</key><string>$HOME/.cumora/daemon.log</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$PATH</string>
    <key>HOME</key><string>$HOME</string>
    <key>CUMORA_VERSION</key><string>$version</string>
    <key>CUMORA_AGENT_READ_PATHS</key><string>$read_paths</string>
$hermes_env
  </dict>
</dict></plist>
PLIST

launchctl unload "$plist" 2>/dev/null || true
launchctl load "$plist"
echo "自建常駐程式已啟動（來源：$repo）。"
echo "智能體可讀目錄：$read_paths"
[ -n "$hermes_env" ] && echo "Hermes 引擎：已啟用（容器執行，模型走宿主 LM Studio）"
echo "日誌：~/.cumora/daemon.log"
