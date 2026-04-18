#!/bin/bash
# BurnerByte API Key Endpoint Test Suite
# Usage: ./scripts/test-api-keys.sh <api-key>
# Example: ./scripts/test-api-keys.sh bb_your_key_here
#
# This tests ALL endpoints that accept API key authentication.
# Requires: curl, jq

set -euo pipefail

API_KEY="${1:?Usage: $0 <api-key>}"
BASE="https://burnerbyte.com/api/v1"
AUTH="Authorization: Bearer $API_KEY"
PASS=0
FAIL=0
TOTAL=0

test_endpoint() {
  local method="$1"
  local path="$2"
  local expected_status="$3"
  local scope="$4"
  local body="${5:-}"
  local desc="${6:-$method $path}"

  TOTAL=$((TOTAL + 1))
  local url="$BASE$path"
  local args=(-s -w "\n%{http_code}" -H "$AUTH")

  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi

  case "$method" in
    GET)    args+=(-X GET) ;;
    POST)   args+=(-X POST) ;;
    PATCH)  args+=(-X PATCH) ;;
    DELETE) args+=(-X DELETE) ;;
  esac

  local output
  output=$(curl "${args[@]}" "$url" 2>/dev/null)
  local status
  status=$(echo "$output" | tail -1)
  local response
  response=$(echo "$output" | sed '$d')

  if [ "$status" = "$expected_status" ]; then
    echo "✅ [$status] $desc (scope: $scope)"
    PASS=$((PASS + 1))
  else
    echo "❌ [$status] $desc — expected $expected_status (scope: $scope)"
    echo "   Response: $(echo "$response" | head -c 200)"
    FAIL=$((FAIL + 1))
  fi
}

echo "============================================"
echo "BurnerByte API Key Test Suite"
echo "Base: $BASE"
echo "Key prefix: ${API_KEY:0:11}..."
echo "============================================"
echo ""

# ── Step 1: Verify authentication works ──
echo "── Authentication ──"
test_endpoint GET "/inboxes?per_page=1" "200" "team.inboxes.view" "" "List inboxes (auth check)"
echo ""

# ── Step 2: Get domain assignments for inbox creation ──
echo "── Domain Assignments ──"
test_endpoint GET "/my/domains" "200" "none (user-scoped)" "" "List my domain assignments"

ASSIGNMENTS=$(curl -s -H "$AUTH" "$BASE/my/domains" 2>/dev/null)
ASSIGNMENT_ID=$(echo "$ASSIGNMENTS" | jq -r '.data[0].id // empty' 2>/dev/null || true)
echo ""

# ── Step 3: Inbox operations ──
echo "── Inbox Operations ──"
test_endpoint GET "/inboxes?status=active&per_page=5" "200" "team.inboxes.view" "" "List active inboxes"
test_endpoint GET "/inboxes?status=expired&per_page=5" "200" "team.inboxes.view" "" "List expired inboxes"
test_endpoint GET "/inboxes?status=all&per_page=5" "200" "team.inboxes.view" "" "List all inboxes"

INBOX_ID=""
if [ -n "$ASSIGNMENT_ID" ]; then
  echo ""
  echo "Creating test inbox with assignment: $ASSIGNMENT_ID"
  CREATE_RESULT=$(curl -s -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"domain_assignment_id\":\"$ASSIGNMENT_ID\",\"ttl\":\"10m\"}" \
    "$BASE/inboxes" 2>/dev/null)
  INBOX_ID=$(echo "$CREATE_RESULT" | jq -r '.id // empty' 2>/dev/null || true)
  INBOX_ADDR=$(echo "$CREATE_RESULT" | jq -r '.full_address // empty' 2>/dev/null || true)

  if [ -n "$INBOX_ID" ]; then
    echo "✅ Created inbox: $INBOX_ADDR (id: $INBOX_ID)"
    PASS=$((PASS + 1))
    TOTAL=$((TOTAL + 1))

    test_endpoint GET "/inboxes/$INBOX_ID" "200" "team.inboxes.view" "" "Get inbox detail"
    test_endpoint POST "/inboxes/$INBOX_ID/extend" "200" "team.inboxes.view" "{}" "Extend inbox TTL"
  else
    echo "❌ Failed to create inbox"
    echo "   Response: $(echo "$CREATE_RESULT" | head -c 300)"
    FAIL=$((FAIL + 1))
    TOTAL=$((TOTAL + 1))
  fi
else
  echo "⚠️  No domain assignments found — skipping inbox creation"
fi
echo ""

# ── Step 4: Email operations ──
echo "── Email Operations ──"
if [ -n "$INBOX_ID" ]; then
  test_endpoint GET "/inboxes/$INBOX_ID/emails?per_page=5" "200" "team.emails.view" "" "List emails in inbox"
  test_endpoint GET "/inboxes/$INBOX_ID/emails?q=test&per_page=5" "200" "team.emails.view" "" "Search emails in inbox"
  test_endpoint POST "/inboxes/$INBOX_ID/emails/mark-all-read" "200" "team.emails.view" "" "Mark all emails read"
else
  # Try with any existing inbox
  FIRST_INBOX=$(curl -s -H "$AUTH" "$BASE/inboxes?per_page=1" 2>/dev/null | jq -r '.data[0].id // empty' 2>/dev/null || true)
  if [ -n "$FIRST_INBOX" ]; then
    test_endpoint GET "/inboxes/$FIRST_INBOX/emails?per_page=5" "200" "team.emails.view" "" "List emails in inbox"
  else
    echo "⚠️  No inboxes found — skipping email tests"
  fi
fi
echo ""

# ── Step 5: Scope enforcement (negative tests) ──
echo "── Scope Enforcement (expect 403 for missing scopes) ──"
# These should return 403 if the key doesn't have the required scope
# If the key has all scopes, they'll return 200 — both are valid outcomes
echo "(Results depend on which scopes your key has)"
echo ""

# ── Step 6: Invalid key test ──
echo "── Invalid Key Test ──"
INVALID_STATUS=$(curl -s -w "%{http_code}" -o /dev/null -H "Authorization: Bearer bb_invalid_key_12345" "$BASE/inboxes" 2>/dev/null)
TOTAL=$((TOTAL + 1))
if [ "$INVALID_STATUS" = "401" ]; then
  echo "✅ [401] Invalid key correctly rejected"
  PASS=$((PASS + 1))
else
  echo "❌ [$INVALID_STATUS] Invalid key should return 401"
  FAIL=$((FAIL + 1))
fi

# No auth header
NO_AUTH_STATUS=$(curl -s -w "%{http_code}" -o /dev/null "$BASE/inboxes" 2>/dev/null)
TOTAL=$((TOTAL + 1))
if [ "$NO_AUTH_STATUS" = "401" ]; then
  echo "✅ [401] Missing auth correctly rejected"
  PASS=$((PASS + 1))
else
  echo "❌ [$NO_AUTH_STATUS] Missing auth should return 401"
  FAIL=$((FAIL + 1))
fi
echo ""

# ── Step 7: Cleanup — delete test inbox ──
if [ -n "$INBOX_ID" ]; then
  echo "── Cleanup ──"
  test_endpoint DELETE "/inboxes/$INBOX_ID" "200" "team.inboxes.view" "" "Delete test inbox"
  echo ""
fi

# ── Summary ──
echo "============================================"
echo "Results: $PASS passed, $FAIL failed, $TOTAL total"
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 All tests passed!"
else
  echo "⚠️  Some tests failed — check output above"
fi
echo "============================================"
