#!/bin/bash
# REVV triage bundle collector
# Usage examples:
#   bash scripts/triage-bundle.sh
#   bash scripts/triage-bundle.sh --issue "RO calendar label stuck"
#   bash scripts/triage-bundle.sh --run-tests --run-smoke --base-url https://revvshop.app

set -uo pipefail

BASE_URL="https://revvshop.app"
RUN_TESTS=0
RUN_SMOKE=0
NO_NETWORK=0
ISSUE_TITLE=""
OUT_ROOT="${TRIAGE_OUT_ROOT:-${HOME}/triage-bundles}"

usage() {
  cat <<'USAGE'
Usage: bash scripts/triage-bundle.sh [options]

Options:
  --issue "<title>"     Short issue title saved into the report
  --base-url <url>      Base URL for live checks (default: https://revvshop.app)
  --run-tests           Run frontend regression tests and capture output
  --run-smoke           Run scripts/smoke-test.sh and capture output
  --no-network          Skip curl/live endpoint checks
  --out-root <dir>      Output root directory (default: ~/triage-bundles)
  -h, --help            Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue)
      ISSUE_TITLE="${2:-}"
      shift 2
      ;;
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --run-tests)
      RUN_TESTS=1
      shift
      ;;
    --run-smoke)
      RUN_SMOKE=1
      shift
      ;;
    --no-network)
      NO_NETWORK=1
      shift
      ;;
    --out-root)
      OUT_ROOT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

TS="$(date +"%Y%m%d-%H%M%S")"
OUT_DIR="${OUT_ROOT}/triage-${TS}"
if ! mkdir -p "${OUT_DIR}" 2>/dev/null; then
  OUT_ROOT="${TMPDIR:-/tmp}/revv-triage-bundles"
  OUT_DIR="${OUT_ROOT}/triage-${TS}"
  mkdir -p "${OUT_DIR}" 2>/dev/null || {
    echo "Failed to create output directory: ${OUT_DIR}" >&2
    exit 1
  }
fi

say() {
  printf '[triage] %s\n' "$*"
}

run_capture() {
  local file="$1"
  shift
  {
    echo "# time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "# cwd: $(pwd)"
    echo "# cmd: $*"
    echo ""
    "$@"
  } > "${OUT_DIR}/${file}" 2>&1 || true
}

run_capture_sh() {
  local file="$1"
  shift
  {
    echo "# time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "# cwd: $(pwd)"
    echo "# cmd: $*"
    echo ""
    bash -lc "$*"
  } > "${OUT_DIR}/${file}" 2>&1 || true
}

say "Collecting metadata"
run_capture_sh meta.txt "date; date -u; uname -a; whoami; pwd; hostname"
run_capture_sh versions.txt "node -v; npm -v; (cd frontend && npm -v)"
run_capture_sh git-status.txt "git status --short; echo; git status -sb"
run_capture_sh git-log.txt "git log --oneline --decorate -n 20"
run_capture_sh git-diff-stat.txt "git diff --stat"
run_capture_sh git-diff.patch "git diff"

say "Collecting app context"
run_capture_sh package-root.json.txt "cat package.json"
run_capture_sh package-frontend.json.txt "cat frontend/package.json"
run_capture_sh backend-routes-ros-head.txt "sed -n '1,220p' backend/src/routes/ros.js"
run_capture_sh dashboard-head.txt "sed -n '1,260p' frontend/src/pages/Dashboard.jsx"
run_capture_sh language-context-head.txt "sed -n '1,260p' frontend/src/contexts/LanguageContext.jsx"
run_capture_sh frontend-dist-assets.txt "ls -la frontend/dist/assets 2>/dev/null || true"

say "Collecting sanitized environment hints"
run_capture_sh env-hints.txt "env | rg -N '^(NODE_ENV|RAILWAY_|DATABASE_URL|PORT|REVV_|OPENCLAW_|OLLAMA_HOST)=' | sed -E 's/(TOKEN|KEY|SECRET|PASSWORD|PASS)=.*/\\1=[REDACTED]/g'"

if [[ "${NO_NETWORK}" -eq 0 ]]; then
  say "Collecting live endpoint checks from ${BASE_URL}"
  run_capture_sh network-health.txt "curl -isS -m 20 \"${BASE_URL}/api/health\""
  run_capture_sh network-home-head.txt "curl -sS -m 20 \"${BASE_URL}/?t=\$(date +%s)\" | sed -n '1,80p'"
else
  say "Skipping network checks (--no-network)"
fi

if [[ "${RUN_TESTS}" -eq 1 ]]; then
  say "Running frontend tests"
  run_capture_sh frontend-test-run.txt "cd frontend && npm run test:run"
fi

if [[ "${RUN_SMOKE}" -eq 1 ]]; then
  say "Running smoke test"
  run_capture_sh smoke-test.txt "bash scripts/smoke-test.sh \"${BASE_URL}\""
fi

if command -v openclaw >/dev/null 2>&1; then
  say "Collecting OpenClaw diagnostics"
  run_capture_sh openclaw-health.txt "openclaw health"
  run_capture_sh openclaw-cron-list.txt "openclaw cron list"
  run_capture_sh openclaw-node-status.txt "openclaw node status"
fi

if command -v ollama >/dev/null 2>&1; then
  say "Collecting Ollama model list"
  run_capture_sh ollama-list.txt "ollama list"
fi

cat > "${OUT_DIR}/ISSUE_REPORT.md" <<EOF
# Issue Report

- Created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Bundle Path: ${OUT_DIR}
- Issue Title: ${ISSUE_TITLE:-<fill this in>}
- Base URL: ${BASE_URL}

## Goal
<what should happen>

## Actual
<what is happening>

## Repro Steps
1. <step>
2. <step>
3. <step>

## Impact
<who/what is affected>

## Done When
<clear pass criteria>

## Attach This Bundle
- meta.txt
- versions.txt
- git-status.txt
- git-diff-stat.txt
- network-health.txt (if generated)
- frontend-test-run.txt (if generated)
- smoke-test.txt (if generated)
EOF

TARBALL="${OUT_DIR}.tar.gz"
tar -czf "${TARBALL}" -C "$(dirname "${OUT_DIR}")" "$(basename "${OUT_DIR}")" >/dev/null 2>&1 || true

say "Bundle created: ${OUT_DIR}"
if [[ -f "${TARBALL}" ]]; then
  say "Archive created: ${TARBALL}"
fi
say "Open report: ${OUT_DIR}/ISSUE_REPORT.md"
