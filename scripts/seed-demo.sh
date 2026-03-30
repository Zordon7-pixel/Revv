#!/bin/bash
# REVV Auto Body Shop — Demo Seed Script (Bash Wrapper)
# 
# Usage:
#   bash scripts/seed-demo.sh              # Normal seed (idempotent, skips existing)
#   bash scripts/seed-demo.sh --force      # Wipe existing demo shop and recreate
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"

if [ ! -d "$BACKEND_DIR" ]; then
  echo "❌ Error: backend directory not found at $BACKEND_DIR"
  exit 1
fi

# Check for .env
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "⚠️  Warning: No .env file found. Copy .env.example and configure DATABASE_URL."
  echo "   $BACKEND_DIR/.env.example exists — run:"
  echo "   cp $BACKEND_DIR/.env.example $BACKEND_DIR/.env"
  exit 1
fi

# Run the Node seed script
cd "$BACKEND_DIR"
node ../scripts/seed-demo.js "$@"
