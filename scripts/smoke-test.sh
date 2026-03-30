#!/bin/bash
# REVV Post-Deploy Smoke Test
# Run after every Railway deploy to catch silent failures
# Usage: ./scripts/smoke-test.sh [base_url]
# Example: ./scripts/smoke-test.sh https://revv-production-ffa9.up.railway.app

BASE_URL="${1:-https://revv-production-ffa9.up.railway.app}"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASS${NC} $1"; ((PASS++)); }
fail() { echo -e "${RED}❌ FAIL${NC} $1"; ((FAIL++)); }
warn() { echo -e "${YELLOW}⚠️  WARN${NC} $1"; }

echo ""
echo "🔧 REVV Smoke Test — $BASE_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Health check
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  pass "Health endpoint /api/health → 200"
else
  fail "Health endpoint /api/health → $STATUS (expected 200)"
fi

# 2. Login with demo account
LOGIN_RESP=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@revvauto.com","password":"RevvDemo123!"}' 2>/dev/null)
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
if [ -n "$TOKEN" ] && [ "$TOKEN" != "ERROR" ]; then
  pass "Auth /api/auth/login → token received"
else
  fail "Auth /api/auth/login → no token (response: $LOGIN_RESP)"
fi

# 3. Authenticated route — RO list (owner access)
if [ -n "$TOKEN" ]; then
  ROS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/ros" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ "$ROS_STATUS" = "200" ]; then
    pass "Authenticated /api/ros → 200"
  else
    fail "Authenticated /api/ros → $ROS_STATUS (expected 200)"
  fi
fi

# 4. Frontend loads
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null)
if [ "$FRONTEND_STATUS" = "200" ]; then
  pass "Frontend / → 200"
else
  fail "Frontend / → $FRONTEND_STATUS (expected 200)"
fi

# 5. Rate limiter check (trust proxy working)
RL_RESP=$(curl -s "$BASE_URL/api/auth/login" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 1.2.3.4" \
  -d '{"email":"test@test.com","password":"wrong"}' 2>/dev/null)
if echo "$RL_RESP" | grep -q "ERR_ERL\|ValidationError\|UNEXPECTED"; then
  fail "Rate limiter trust proxy error detected — app.set('trust proxy', 1) may be missing"
else
  pass "Rate limiter X-Forwarded-For handled correctly"
fi

# 6. Resend domain check
RESEND_KEY="${RESEND_API_KEY:-}"
if [ -z "$RESEND_KEY" ]; then
  warn "RESEND_API_KEY not set in env — skipping email domain check"
else
  DOMAINS=$(curl -s https://api.resend.com/domains \
    -H "Authorization: Bearer $RESEND_KEY" 2>/dev/null)
  VERIFIED=$(echo "$DOMAINS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
verified=[x['name'] for x in d.get('data',[]) if x.get('status')=='verified']
print(','.join(verified))
" 2>/dev/null)
  if [ -n "$VERIFIED" ]; then
    pass "Resend verified domains: $VERIFIED"
  else
    fail "No verified Resend domains found — emails will fail"
  fi
fi

# 7. SPF record check
SPF=$(dig TXT send.revvshop.app +short 2>/dev/null | tr -d '"')
if echo "$SPF" | grep -q "resend.dev"; then
  pass "SPF record send.revvshop.app contains resend.dev"
else
  warn "SPF record for send.revvshop.app missing or incorrect: '$SPF'"
fi

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}✅ All $TOTAL checks passed — safe to ship${NC}"
  exit 0
else
  echo -e "${RED}❌ $FAIL/$TOTAL checks failed — DO NOT ship until fixed${NC}"
  exit 1
fi
