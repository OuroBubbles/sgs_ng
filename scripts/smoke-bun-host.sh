#!/usr/bin/env bash
# P0 探针：用 Bun 直接跑现有 server 入口做一次 hello 握手。
# 不删除 node/esbuild 产物路径；已知阻塞点记入输出供 P1。
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "smoke-bun-host: SKIP — bun not installed (P1 will pin Bun)."
  exit 0
fi

eval "$(node --input-type=module <<'NODE'
import { protocolHash, contentHash } from './scripts/network-build.mjs';
console.log(`export SGS_PROTOCOL_HASH=${JSON.stringify(protocolHash())}`);
console.log(`export SGS_CONTENT_HASH=${JSON.stringify(contentHash())}`);
NODE
)"

PORT_FILE="$(mktemp)"
cleanup() {
  if [[ -n "${HOST_PID:-}" ]] && kill -0 "$HOST_PID" 2>/dev/null; then
    kill "$HOST_PID" 2>/dev/null || true
    wait "$HOST_PID" 2>/dev/null || true
  fi
  rm -f "$PORT_FILE"
}
trap cleanup EXIT

set +e
SGS_HOST=127.0.0.1 SGS_PORT=0 \
  bun --define "__SGS_PROTOCOL_HASH__=\"${SGS_PROTOCOL_HASH}\"" \
      --define "__SGS_CONTENT_HASH__=\"${SGS_CONTENT_HASH}\"" \
      src/server/main.ts >"$PORT_FILE" 2>&1 &
HOST_PID=$!
set -e

for _ in $(seq 1 80); do
  if ! kill -0 "$HOST_PID" 2>/dev/null; then
    OUTPUT="$(cat "$PORT_FILE")"
    if grep -q 'import.meta.glob is not a function' <<<"$OUTPUT"; then
      echo "smoke-bun-host: BLOCKED — Bun cannot run current content index (import.meta.glob is Vite-only)."
      echo "smoke-bun-host: P1 follow-up — replace Vite glob content registration with Bun directory scan / static imports before bun run host."
      echo "smoke-bun-host: protocolHash=${SGS_PROTOCOL_HASH:0:12}… contentHash=${SGS_CONTENT_HASH:0:12}… (hashes computable; handshake not reached)"
      exit 0
    fi
    echo "smoke-bun-host: Bun host exited before listen. Output:"
    echo "$OUTPUT"
    exit 1
  fi
  if grep -qE 'http://127\.0\.0\.1:[0-9]+/\?online=1' "$PORT_FILE"; then
    break
  fi
  sleep 0.1
done

URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/\?online=1' "$PORT_FILE" | head -1 || true)"
if [[ -z "$URL" ]]; then
  echo "smoke-bun-host: timed out waiting for listen. Output:"
  cat "$PORT_FILE"
  exit 1
fi
PORT="${URL#http://127.0.0.1:}"
PORT="${PORT%%/*}"

SGS_SMOKE_PORT="$PORT" SGS_PROTOCOL_HASH="$SGS_PROTOCOL_HASH" SGS_CONTENT_HASH="$SGS_CONTENT_HASH" \
node --input-type=module <<'NODE'
import { WebSocket } from 'ws';
const protocol = process.env.SGS_PROTOCOL_HASH;
const content = process.env.SGS_CONTENT_HASH;
const port = process.env.SGS_SMOKE_PORT;
await new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/game`);
  const timer = setTimeout(() => reject(new Error('hello timeout')), 5000);
  let greeted = false;
  socket.on('message', (data) => {
    const msg = JSON.parse(String(data));
    if (!greeted && msg.kind === 'hello') {
      greeted = true;
      if (msg.protocol !== protocol) {
        clearTimeout(timer);
        reject(new Error(`protocol mismatch: got ${msg.protocol}`));
        return;
      }
      if (msg.content !== content) {
        clearTimeout(timer);
        reject(new Error(`content mismatch: got ${msg.content}`));
        return;
      }
      socket.send(JSON.stringify({ kind: 'hello', protocol, content, build: protocol }));
      return;
    }
    if (msg.kind === 'seat' || msg.kind === 'error') {
      clearTimeout(timer);
      socket.close();
      if (msg.kind === 'error') reject(new Error(msg.message));
      else {
        console.log('smoke-bun-host: hello ok; seat', msg.seat);
        resolve(undefined);
      }
    }
  });
  socket.on('error', reject);
});
NODE

echo "smoke-bun-host: PASS (Bun $(bun --version))"
