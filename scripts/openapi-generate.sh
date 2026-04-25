#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
env -u NODE_USE_SYSTEM_CA -u NODE_EXTRA_CA_CERTS \
  npx openapi-typescript backend/openapi.yaml -o packages/api-types/generated.ts
echo "generated packages/api-types/generated.ts from backend/openapi.yaml"
