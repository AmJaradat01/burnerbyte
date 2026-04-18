#!/bin/bash
# BurnerByte API Key Scope Enforcement Test
# Creates an API key with specific scopes and verifies that:
# - Endpoints matching the scopes return 200
# - Endpoints NOT matching the scopes return 403
#
# Usage: ./scripts/test-apikey-scopes.sh <email> <password>
# Requires: curl, jq

set -euo pipefail

EMAIL="${1:?Usage: $0 <email> <password>}"
PASSWORD="${2:?Usage: $0 <email> <password>}"
BASE="https://burnerbyte.com/api/v1"
PASS=0; FAIL=0; TOTAL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

ok() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo -e "  ${GREEN}✅${NC} $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo -e "  ${RED}❌${NC} $1"; }
section() { echo -e "\n${CYAN}── $1 ──${NC}"; }

echo "============================================"
echo "BurnerByte API Key Scope Enforcement Test"
echo "============================================"

# ── Login with JWT to create test keys ──
section "Setup — Login & Create Test Keys"
LOGIN=$(curl -s -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/auth/login")
TOKEN=$(echo "$LOGIN" | jq -r '.tokens.access_token // empty')
[ -z "$TOKEN" ] && { echo "Login failed"; exit 1; }
ok "JWT login"

ORG_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/orgs" | jq -r '.data[0].id')
TEAM_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/teams?per_page=1" | jq -r '.data[0].id')

# Create KEY A: only inbox view (read-only)
KEY_A=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"test-scope-readonly","scopes":["team.inboxes.view"]}' \
  "$BASE/orgs/$ORG_ID/teams/$TEAM_ID/api-keys")
KEY_A_ID=$(echo "$KEY_A" | jq -r '.id')
KEY_A_RAW=$(echo "$KEY_A" | jq -r '.raw_key')
ok "Created KEY A (team.inboxes.view only): ${KEY_A_RAW:0:15}..."

# Create KEY B: inbox create + view + email view
KEY_B=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"test-scope-readwrite","scopes":["team.inboxes.view","team.inboxes.create","team.emails.view"]}' \
  "$BASE/orgs/$ORG_ID/teams/$TEAM_ID/api-keys")
KEY_B_ID=$(echo "$KEY_B" | jq -r '.id')
KEY_B_RAW=$(echo "$KEY_B" | jq -r '.raw_key')
ok "Created KEY B (view + create + emails): ${KEY_B_RAW:0:15}..."

# Create KEY C: webhook manage only
KEY_C=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"test-scope-webhooks","scopes":["team.webhooks.view","team.webhooks.manage"]}' \
  "$BASE/orgs/$ORG_ID/teams/$TEAM_ID/api-keys")
KEY_C_ID=$(echo "$KEY_C" | jq -r '.id')
KEY_C_RAW=$(echo "$KEY_C" | jq -r '.raw_key')
ok "Created KEY C (webhooks only): ${KEY_C_RAW:0:15}..."

# Helper: test with a specific key
test_key() {
  local key="$1" method="$2" path="$3" expected="$4" desc="$5" body="${6:-}"
  TOTAL=$((TOTAL+1))
  local args=(-s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $key" -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(-d "$body")
  local status
  status=$(curl -X "$method" "${args[@]}" "$BASE$path" 2>/dev/null)
  if [ "$status" = "$expected" ]; then
    echo -e "  ${GREEN}✅${NC} [$status] $desc"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}❌${NC} [$status] $desc — expected $expected"
    FAIL=$((FAIL+1))
  fi
}

# ═══════════════════════════════════════════
# KEY A: team.inboxes.view only
# ═══════════════════════════════════════════
section "KEY A — team.inboxes.view only"
test_key "$KEY_A_RAW" GET "/inboxes?per_page=1" "200" "List inboxes → 200 (has scope)"
test_key "$KEY_A_RAW" GET "/my/domains" "200" "List domains → 200 (no scope check)"

# Get an assignment for inbox creation test
ASSIGNMENT_ID=$(curl -s -H "Authorization: Bearer $KEY_A_RAW" "$BASE/my/domains" 2>/dev/null | jq -r '.data[0].id // empty')

if [ -n "$ASSIGNMENT_ID" ]; then
  test_key "$KEY_A_RAW" POST "/inboxes" "403" "Create inbox → 403 (missing team.inboxes.create)" "{\"domain_assignment_id\":\"$ASSIGNMENT_ID\",\"ttl\":\"5m\"}"
fi

# KEY A should NOT be able to access emails (missing team.emails.view)
FIRST_INBOX=$(curl -s -H "Authorization: Bearer $KEY_A_RAW" "$BASE/inboxes?per_page=1" 2>/dev/null | jq -r '.data[0].id // empty')
if [ -n "$FIRST_INBOX" ]; then
  test_key "$KEY_A_RAW" GET "/inboxes/$FIRST_INBOX/emails?per_page=1" "403" "List emails → 403 (missing team.emails.view)"
fi

# ═══════════════════════════════════════════
# KEY B: inbox view + create + email view
# ═══════════════════════════════════════════
section "KEY B — view + create + emails"
test_key "$KEY_B_RAW" GET "/inboxes?per_page=1" "200" "List inboxes → 200"

# Create inbox with KEY B
CREATED_INBOX=""
if [ -n "$ASSIGNMENT_ID" ]; then
  CREATED=$(curl -s -H "Authorization: Bearer $KEY_B_RAW" -H "Content-Type: application/json" \
    -d "{\"domain_assignment_id\":\"$ASSIGNMENT_ID\",\"ttl\":\"5m\"}" "$BASE/inboxes" 2>/dev/null)
  CREATED_INBOX=$(echo "$CREATED" | jq -r '.id // empty')
  CREATED_ADDR=$(echo "$CREATED" | jq -r '.full_address // empty')
  [ -n "$CREATED_INBOX" ] && ok "Create inbox → 201 ($CREATED_ADDR)" || fail "Create inbox with KEY B"
fi

# KEY B can read emails
if [ -n "$CREATED_INBOX" ]; then
  test_key "$KEY_B_RAW" GET "/inboxes/$CREATED_INBOX/emails?per_page=1" "200" "List emails → 200 (has scope)"
  test_key "$KEY_B_RAW" POST "/inboxes/$CREATED_INBOX/emails/mark-all-read" "200" "Mark all read → 200"
fi

# KEY B should NOT be able to manage webhooks
test_key "$KEY_B_RAW" GET "/orgs/$ORG_ID/teams/$TEAM_ID/webhooks?per_page=1" "403" "List webhooks → 403 (missing team.webhooks.view)"

# ═══════════════════════════════════════════
# KEY C: webhooks only
# ═══════════════════════════════════════════
section "KEY C — webhooks only"
test_key "$KEY_C_RAW" GET "/orgs/$ORG_ID/teams/$TEAM_ID/webhooks?per_page=1" "200" "List webhooks → 200 (has scope)"
test_key "$KEY_C_RAW" GET "/inboxes?per_page=1" "403" "List inboxes → 403 (missing team.inboxes.view)"

if [ -n "$FIRST_INBOX" ]; then
  test_key "$KEY_C_RAW" GET "/inboxes/$FIRST_INBOX/emails?per_page=1" "403" "List emails → 403 (missing team.emails.view)"
fi

# Create webhook with KEY C
WH_RESULT=$(curl -s -H "Authorization: Bearer $KEY_C_RAW" -H "Content-Type: application/json" \
  -d '{"url":"https://httpbin.org/post","events":["email.received"],"secret":"test123"}' \
  "$BASE/orgs/$ORG_ID/teams/$TEAM_ID/webhooks" 2>/dev/null)
WH_ID=$(echo "$WH_RESULT" | jq -r '.id // empty')
[ -n "$WH_ID" ] && ok "Create webhook → 201 ($WH_ID)" || fail "Create webhook with KEY C"

# ═══════════════════════════════════════════
# CROSS-KEY ISOLATION
# ═══════════════════════════════════════════
section "Cross-Key Isolation"
# KEY A can't do what KEY B can
if [ -n "$ASSIGNMENT_ID" ]; then
  test_key "$KEY_A_RAW" POST "/inboxes" "403" "KEY A can't create inbox (KEY B can)" "{\"domain_assignment_id\":\"$ASSIGNMENT_ID\",\"ttl\":\"5m\"}"
fi
# KEY B can't do what KEY C can
test_key "$KEY_B_RAW" POST "/orgs/$ORG_ID/teams/$TEAM_ID/webhooks" "403" "KEY B can't create webhook (KEY C can)" '{"url":"https://example.com","events":["email.received"]}'

# ═══════════════════════════════════════════
# CLEANUP
# ═══════════════════════════════════════════
section "Cleanup"
# Delete test inbox
if [ -n "$CREATED_INBOX" ]; then
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/inboxes/$CREATED_INBOX" > /dev/null 2>&1
  ok "Deleted test inbox"
fi
# Delete test webhook
if [ -n "$WH_ID" ]; then
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/teams/$TEAM_ID/webhooks/$WH_ID" > /dev/null 2>&1
  ok "Deleted test webhook"
fi
# Revoke test keys
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/teams/$TEAM_ID/api-keys/$KEY_A_ID" > /dev/null 2>&1
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/teams/$TEAM_ID/api-keys/$KEY_B_ID" > /dev/null 2>&1
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/teams/$TEAM_ID/api-keys/$KEY_C_ID" > /dev/null 2>&1
ok "Revoked 3 test API keys"

# ═══════════════════════════════════════════
echo ""
echo "============================================"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, $TOTAL total"
[ "$FAIL" -eq 0 ] && echo -e "🎉 ${GREEN}All tests passed!${NC}" || echo -e "⚠️  ${RED}Some tests failed${NC}"
echo "============================================"
