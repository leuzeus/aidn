#!/usr/bin/env sh
set -eu

AIDN_REF="${AIDN_REF:-dev}"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required. Install Node.js 18 or newer." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required." >&2
  exit 1
fi

npx "github:leuzeus/aidn#${AIDN_REF}" bootstrap "$@"
