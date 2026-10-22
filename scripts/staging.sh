#!/usr/bin/env bash
# Private test copy of the Hub on this computer. Plain-language guide: docs/STAGING.md.
# - Runs the PR #8 code from a temporary folder, on 127.0.0.1 only, with a brand-new empty database.
# - Never reads .env and never touches the real data folder or the running Hub.
# - Telegram, schedules, MCP and other external actions are off. Only private Claude replies work,
#   through this Mac's own Claude app login (no paid API fallback).
# - Your phrase is typed hidden and lives only in the test server's memory. It is never written anywhere.
# - Stops by itself after 30 minutes (or Ctrl+C) and deletes everything it made.
set -euo pipefail
set +o history 2>/dev/null || true

BRANCH="${STAGING_BRANCH:-claude/whatsapp-chat-nav}"
REF="${STAGING_REF:-}"                # set to test a local commit instead of fetching the branch
LIMIT="${STAGING_SECONDS:-1800}"      # 30 minutes
PORT="${STAGING_PORT:-4400}"

say() { printf '%s\n' "$*"; }
fail() { say "Stopped: $*" >&2; exit 1; }

for tool in git node npm curl tar; do command -v "$tool" >/dev/null || fail "$tool is not installed."; done
REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "run this inside your VG-hoster folder."

WORK="$(mktemp -d "${TMPDIR:-/tmp}/hub-staging.XXXXXX")"
SERVER_PID=""
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
  say "Test copy stopped. Its temporary data was deleted."
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

say "Preparing the test copy. Your real Hub is not changed..."
if [ -z "$REF" ]; then git -C "$REPO" fetch --quiet origin "$BRANCH"; REF=FETCH_HEAD; fi
mkdir -p "$WORK/app" "$WORK/data" "$WORK/work"
git -C "$REPO" archive "$REF" | tar -x -C "$WORK/app"
(cd "$WORK/app" && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null) || fail "could not install the test copy."

port_free() { node -e 'const s=require("net").createServer();s.once("error",()=>process.exit(1));s.listen(+process.argv[1],"127.0.0.1",()=>s.close(()=>process.exit(0)))' "$1"; }
while ! port_free "$PORT"; do
  PORT=$((PORT + 1))
  [ "$PORT" -le 4499 ] || fail "no free port between 4400 and 4499."
done

say ""
say "Choose a test phrase (at least 8 characters). Nothing shows while you type."
IFS= read -rs -p "Phrase: " PHRASE; say ""
IFS= read -rs -p "Type it again: " AGAIN; say ""
[ "${#PHRASE}" -ge 8 ] || { PHRASE=""; AGAIN=""; fail "the phrase is shorter than 8 characters."; }
[ "$PHRASE" = "$AGAIN" ] || { PHRASE=""; AGAIN=""; fail "the two phrases did not match."; }
AGAIN=""

(
  # Start from an almost empty environment so no real keys or tokens reach the test copy.
  for v in $(compgen -e); do
    case "$v" in PATH|HOME|USER|LOGNAME|TMPDIR|LANG) ;; *) unset "$v" 2>/dev/null || true ;; esac
  done
  export BRIDGE_TOKEN="$PHRASE" HUB_STAGING=1 HOST=127.0.0.1 PORT="$PORT" TRUST_PROXY=0 \
    DB_FILE="$WORK/data/bridge.db" BACKUP_DIR="$WORK/data/backups" WORK_DIR="$WORK/work" BRIDGE_DIR="$WORK/app" \
    AI_ENGINE=subscription HUB_PRIVATE_CLAUDE_CLI=1 TRIAL_START=1 TELEGRAM_POLL=0 TELEGRAM_MIRROR=0 \
    AUTO_WORK=0 AUTO_DISPATCH=0 DEVICE_LOGIN_DAYS=1
  cd "$WORK/app"
  exec node --no-warnings server.js
) >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
PHRASE=""

for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2>/dev/null || fail "the test copy did not start."
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || fail "the test copy did not answer."

say ""
say "Test copy is running: http://127.0.0.1:$PORT/"
say "Open that link, unlock it with your phrase, open Chats, start a private chat with Claude and send one message."
say "It stops by itself in $((LIMIT / 60)) minutes. Press Ctrl+C to stop it sooner."

END=$((SECONDS + LIMIT))
while kill -0 "$SERVER_PID" 2>/dev/null && [ "$SECONDS" -lt "$END" ]; do sleep 1; done
kill -0 "$SERVER_PID" 2>/dev/null && say "Time is up."
