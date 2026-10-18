#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VITE_PORT="${AKMDL_DEBUG_VITE_PORT:-8802}"
API_PORT="${AKMDL_DEBUG_API_PORT:-8801}"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/userdata/data}"
DOCS_DIR="${DOCS_DIR:-$ROOT_DIR/userdata/docs}"
FRONTEND_DIST="${FRONTEND_DIST:-$ROOT_DIR/frontend/dist}"
GOCACHE_DIR="${AKMDL_GOCACHE:-/tmp/AKMDLibrary/gocache}"

mkdir -p "$DATA_DIR" "$DOCS_DIR" "$GOCACHE_DIR"

cleanup() {
  if [[ -n "${VITE_PID:-}" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting Vite on http://127.0.0.1:$VITE_PORT"
(
  cd "$ROOT_DIR/frontend"
  VITE_API_PROXY_TARGET="http://127.0.0.1:$API_PORT" \
    ./node_modules/.bin/vite --host 127.0.0.1 --port "$VITE_PORT" --strictPort
) &
VITE_PID=$!

echo "Waiting for Vite..."
for _ in {1..100}; do
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "Vite exited before becoming ready." >&2
    exit 1
  fi
  if env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    curl -fsS "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  curl -fsS "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then
  echo "Vite did not become ready on http://127.0.0.1:$VITE_PORT." >&2
  exit 1
fi

echo "Starting desktop debug app..."
(
  cd "$ROOT_DIR/backend"
  AKMDL_DESKTOP_FRONTEND_URL="http://127.0.0.1:$VITE_PORT" \
  AKMDL_DESKTOP_API_PORT="$API_PORT" \
  AKMDL_DESKTOP_DEBUG=1 \
  DATA_DIR="$DATA_DIR" \
  DOCS_DIR="$DOCS_DIR" \
  FRONTEND_DIST="$FRONTEND_DIST" \
  GOCACHE="$GOCACHE_DIR" \
  CGO_ENABLED=1 \
  CGO_LDFLAGS="${CGO_LDFLAGS:-} -framework UniformTypeIdentifiers" \
  go run -tags "desktop,dev,debug,wv2runtime.download" ./cmd/desktop
)
