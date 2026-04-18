#!/bin/bash
# BurnerByte Comprehensive API Test Suite
# Tests ALL documented API endpoints using JWT authentication.
#
# Usage: ./scripts/test-all-endpoints.sh <email> <password>
# Example: ./scripts/test-all-endpoints.sh admin@example.com mypassword
#
# Requires: curl, jq

set -euo pipefail

EMAIL="${1:?Usage: $0 <email> <password>}"
PASSWORD="${2:?Usage: $0 <email> <password>}"
BASE="https://burnerbyte.com/api/v1"
PASS=0
FAIL=0
SKIP=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

test_endpoint() {
  local method="$1" path="$2" expected="$3" desc="$4" body="${5:-}"
  TOTAL=$((TOTAL + 1))
  local url="$BASE$path"
  local args=(-s -w "\n%{http_code}" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(-d "$body")
  case "$method" in
    GET) args+=(-X GET) ;; POST) args+=(-X POST) ;; PATCH) args+=(-X PATCH) ;;
    PUT) args+=(-X PUT) ;; DELETE) args+=(-X DELETE) ;;
  esac
  local output status response
  output=$(curl "${args[@]}" "$url" 2>/dev/null)
  status=$(echo "$output" | tail -1)
  response=$(echo "$output" | sed '$d')
  if [ "$status" = "$expected" ]; then
    echo -e "  ${GREEN}✅${NC} [$status] $desc"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}❌${NC} [$status] $desc — expected $expected"
    echo "     $(echo "$response" | jq -r '.error // .message // .' 2>/dev/null | head -c 150)"
    FAIL=$((FAIL + 1))
  fi
}

test_public() {
  local method="$1" path="$2" expected="$3" desc="$4" body="${5:-}"
  TOTAL=$((TOTAL + 1))
  local url="$BASE$path"
  local args=(-s -w "\n%{http_code}" -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(-d "$body")
  case "$method" in GET) args+=(-X GET) ;; POST) args+=(-X POST) ;; esac
  local output status
  output=$(curl "${args[@]}" "$url" 2>/dev/null)
  status=$(echo "$output" | tail -1)
  if [ "$status" = "$expected" ]; then
    echo -e "  ${GREEN}✅${NC} [$status] $desc"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}❌${NC} [$status] $desc — expected $expected"
    FAIL=$((FAIL + 1))
  fi
}

skip_test() {
  SKIP=$((SKIP + 1))
  echo -e "  ${YELLOW}⏭️${NC}  $1"
}

section() { echo -e "\n${CYAN}── $1 ──${NC}"; }

echo "============================================"
echo "BurnerByte Comprehensive API Test Suite"
echo "Base: $BASE"
echo "============================================"
echo ""

# ═══════════════════════════════════════════
# STEP 0: Login to get JWT token
# ═══════════════════════════════════════════
section "Authentication — Login"
LOGIN_RESULT=$(curl -s -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$BASE/auth/login" 2>/dev/null)
TOKEN=$(echo "$LOGIN_RESULT" | jq -r '.tokens.access_token // empty' 2>/dev/null || true)
REFRESH=$(echo "$LOGIN_RESULT" | jq -r '.tokens.refresh_token // empty' 2>/dev/null || true)
USER_ID=$(echo "$LOGIN_RESULT" | jq -r '.user.id // empty' 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  echo -e "  ${RED}❌ Login failed${NC}"
  echo "  Response: $(echo "$LOGIN_RESULT" | head -c 300)"
  exit 1
fi
echo -e "  ${GREEN}✅${NC} Login successful (user: $USER_ID)"
PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1))

# ═══════════════════════════════════════════
# PUBLIC ENDPOINTS (no auth)
# ═══════════════════════════════════════════
section "Public Endpoints"
test_public GET "/setup/status" "200" "Setup status"
test_public GET "/auth/sso-status" "200" "SSO status"
test_public GET "/roles" "200" "List roles & permissions"

# ═══════════════════════════════════════════
# AUTH ENDPOINTS
# ═══════════════════════════════════════════
section "Auth"
test_endpoint GET "/auth/me" "200" "Get current user"
test_endpoint GET "/auth/sessions" "200" "List sessions"
test_endpoint GET "/auth/me/sso" "200" "List SSO identities"
test_endpoint GET "/auth/datetime-settings" "200" "Get datetime settings"
test_endpoint POST "/auth/refresh" "200" "Refresh token" "{\"refresh_token\":\"$REFRESH\"}"

# ═══════════════════════════════════════════
# ORGS
# ═══════════════════════════════════════════
section "Organizations"
test_endpoint GET "/orgs" "200" "List orgs"

# Get first org ID
ORG_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/orgs" 2>/dev/null | jq -r '.data[0].id // empty' 2>/dev/null || true)
if [ -z "$ORG_ID" ]; then
  echo -e "  ${RED}No org found — skipping org-scoped tests${NC}"
else
  echo "  (Using org: $ORG_ID)"
  test_endpoint GET "/orgs/$ORG_ID" "200" "Get org"
  test_endpoint GET "/orgs/$ORG_ID/settings" "200" "Get org settings"
fi

# ═══════════════════════════════════════════
# MEMBERS
# ═══════════════════════════════════════════
if [ -n "$ORG_ID" ]; then
  section "Members"
  test_endpoint GET "/orgs/$ORG_ID/members?per_page=5" "200" "List members"
  test_endpoint GET "/orgs/$ORG_ID/members/search?q=a" "200" "Search members"
  test_endpoint GET "/orgs/$ORG_ID/invites" "200" "List pending invites"
fi

# ═══════════════════════════════════════════
# DOMAINS
# ═══════════════════════════════════════════
if [ -n "$ORG_ID" ]; then
  section "Domains"
  test_endpoint GET "/orgs/$ORG_ID/domains?per_page=5" "200" "List domains"

  DOMAIN_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/domains?per_page=1" 2>/dev/null | jq -r '.data[0].id // empty' 2>/dev/null || true)
  if [ -n "$DOMAIN_ID" ]; then
    echo "  (Using domain: $DOMAIN_ID)"
    test_endpoint GET "/orgs/$ORG_ID/domains/$DOMAIN_ID" "200" "Get domain detail"
    test_endpoint GET "/orgs/$ORG_ID/domains/$DOMAIN_ID/impact" "200" "Get domain impact"
    test_endpoint GET "/orgs/$ORG_ID/domains/$DOMAIN_ID/verification-history?per_page=5" "200" "Get verification history"
    test_endpoint POST "/orgs/$ORG_ID/domains/$DOMAIN_ID/verify" "200" "Verify domain DNS"
  fi
fi

# ═══════════════════════════════════════════
# TEAMS
# ═══════════════════════════════════════════
if [ -n "$ORG_ID" ]; then
  section "Teams"
  test_endpoint GET "/orgs/$ORG_ID/teams?per_page=10" "200" "List teams"

  TEAM_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/teams?per_page=1" 2>/dev/null | jq -r '.data[0].id // empty' 2>/dev/null || true)
  if [ -n "$TEAM_ID" ]; then
    echo "  (Using team: $TEAM_ID)"
    test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID" "200" "Get team detail"
    test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID/members?per_page=10" "200" "List team members"
    test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID/impact" "200" "Get team impact"
  fi
fi

# ═══════════════════════════════════════════
# DOMAIN ASSIGNMENTS
# ═══════════════════════════════════════════
if [ -n "$ORG_ID" ] && [ -n "$TEAM_ID" ]; then
  section "Domain Assignments"
  test_endpoint GET "/my/domains" "200" "List my domain assignments"
  test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID/domains?per_page=10" "200" "List team domain assignments"
fi

# ═══════════════════════════════════════════
# INBOXES
# ═══════════════════════════════════════════
section "Inboxes"
test_endpoint GET "/inboxes?status=active&per_page=5" "200" "List active inboxes"
test_endpoint GET "/inboxes?status=expired&per_page=5" "200" "List expired inboxes"
test_endpoint GET "/inboxes?status=all&per_page=5" "200" "List all inboxes"

if [ -n "$TEAM_ID" ]; then
  test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID/inboxes?per_page=5" "200" "List team inboxes"
fi

# Create a test inbox
ASSIGNMENT_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/my/domains" 2>/dev/null | jq -r '.data[0].id // empty' 2>/dev/null || true)
TEST_INBOX_ID=""
if [ -n "$ASSIGNMENT_ID" ]; then
  CREATE_RESULT=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"domain_assignment_id\":\"$ASSIGNMENT_ID\",\"ttl\":\"10m\"}" "$BASE/inboxes" 2>/dev/null)
  TEST_INBOX_ID=$(echo "$CREATE_RESULT" | jq -r '.id // empty' 2>/dev/null || true)
  TEST_INBOX_ADDR=$(echo "$CREATE_RESULT" | jq -r '.full_address // empty' 2>/dev/null || true)
  if [ -n "$TEST_INBOX_ID" ]; then
    echo -e "  ${GREEN}✅${NC} Created test inbox: $TEST_INBOX_ADDR"
    PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1))
    test_endpoint GET "/inboxes/$TEST_INBOX_ID" "200" "Get inbox detail"
    test_endpoint POST "/inboxes/$TEST_INBOX_ID/extend" "200" "Extend inbox TTL" "{}"
  fi
fi

# ═══════════════════════════════════════════
# EMAILS
# ═══════════════════════════════════════════
if [ -n "$TEST_INBOX_ID" ]; then
  section "Emails"
  test_endpoint GET "/inboxes/$TEST_INBOX_ID/emails?per_page=5" "200" "List emails"
  test_endpoint GET "/inboxes/$TEST_INBOX_ID/emails?q=test&per_page=5" "200" "Search emails"
  test_endpoint POST "/inboxes/$TEST_INBOX_ID/emails/mark-all-read" "200" "Mark all read" ""
fi

# ═══════════════════════════════════════════
# WEBHOOKS
# ═══════════════════════════════════════════
if [ -n "$ORG_ID" ] && [ -n "$TEAM_ID" ]; then
  section "Webhooks"
  test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID/webhooks?per_page=5" "200" "List webhooks"
fi

# ═══════════════════════════════════════════
# API KEYS
# ═══════════════════════════════════════════
if [ -n "$ORG_ID" ] && [ -n "$TEAM_ID" ]; then
  section "API Keys"
  test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID/api-keys?per_page=5" "200" "List API keys"

  KEY_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/teams/$TEAM_ID/api-keys?per_page=1" 2>/dev/null | jq -r '.data[0].id // empty' 2>/dev/null || true)
  if [ -n "$KEY_ID" ]; then
    test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID/api-keys/$KEY_ID" "200" "Get API key detail"
  fi
fi

# ═══════════════════════════════════════════
# ANALYTICS
# ═══════════════════════════════════════════
if [ -n "$ORG_ID" ]; then
  section "Analytics"
  test_endpoint GET "/orgs/$ORG_ID/analytics" "200" "Org analytics"
  test_endpoint GET "/orgs/$ORG_ID/analytics/emails-per-day?days=7" "200" "Org emails per day"
  test_endpoint GET "/orgs/$ORG_ID/analytics/insights?days=7" "200" "Org insights"

  if [ -n "$TEAM_ID" ]; then
    test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID/analytics" "200" "Team analytics"
    test_endpoint GET "/orgs/$ORG_ID/teams/$TEAM_ID/analytics/emails-per-day?days=7" "200" "Team emails per day"
  fi
fi

# ═══════════════════════════════════════════
# AUDIT
# ═══════════════════════════════════════════
if [ -n "$ORG_ID" ]; then
  section "Audit"
  test_endpoint GET "/orgs/$ORG_ID/audit?per_page=5" "200" "List audit entries"
  test_endpoint GET "/orgs/$ORG_ID/audit/export?format=json" "200" "Export audit (JSON)"
fi

# ═══════════════════════════════════════════
# NOTIFICATIONS
# ═══════════════════════════════════════════
section "Notifications"
test_endpoint GET "/notifications" "200" "List notifications"
test_endpoint POST "/notifications/mark-all-read" "200" "Mark all notifications read" ""

# ═══════════════════════════════════════════
# ADMIN ENDPOINTS
# ═══════════════════════════════════════════
section "Admin"
test_endpoint GET "/admin/stats" "200" "System stats"
test_endpoint GET "/admin/orgs?per_page=5" "200" "List all orgs"
test_endpoint GET "/admin/users?per_page=5" "200" "List all users"
test_endpoint GET "/admin/health" "200" "Health check"
test_endpoint GET "/admin/platform" "200" "Platform settings"
test_endpoint GET "/admin/version" "200" "API version"

section "Admin SSO"
test_endpoint GET "/admin/sso/providers" "200" "List SSO providers"

section "Admin Roles"
ROLES_DATA=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/roles" 2>/dev/null)
echo -e "  Org roles: $(echo "$ROLES_DATA" | jq -r '[.org_roles[].value] | join(", ")' 2>/dev/null)"
echo -e "  Team roles: $(echo "$ROLES_DATA" | jq -r '[.team_roles[].value] | join(", ")' 2>/dev/null)"
echo -e "  Org permissions: $(echo "$ROLES_DATA" | jq -r '.org_permissions | length' 2>/dev/null)"
echo -e "  Team permissions: $(echo "$ROLES_DATA" | jq -r '.team_permissions | length' 2>/dev/null)"

# ═══════════════════════════════════════════
# ERROR HANDLING TESTS
# ═══════════════════════════════════════════
section "Error Handling"
test_endpoint GET "/orgs/00000000-0000-0000-0000-000000000000" "404" "Non-existent org → 404" ""
test_endpoint GET "/inboxes/00000000-0000-0000-0000-000000000000" "404" "Non-existent inbox → 404" ""
test_endpoint GET "/emails/00000000-0000-0000-0000-000000000000" "404" "Non-existent email → 404" ""
test_endpoint GET "/inboxes/not-a-uuid" "400" "Invalid UUID → 400" ""
test_endpoint GET "/inboxes/not-a-uuid/emails" "400" "Invalid inbox UUID for emails → 400" ""

# Test no-auth
TOTAL=$((TOTAL + 1))
NO_AUTH=$(curl -s -w "%{http_code}" -o /dev/null "$BASE/auth/me" 2>/dev/null)
if [ "$NO_AUTH" = "401" ]; then
  echo -e "  ${GREEN}✅${NC} [401] No auth → 401"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}❌${NC} [$NO_AUTH] No auth should return 401"
  FAIL=$((FAIL + 1))
fi

# ═══════════════════════════════════════════
# CLEANUP
# ═══════════════════════════════════════════
if [ -n "$TEST_INBOX_ID" ]; then
  section "Cleanup"
  test_endpoint DELETE "/inboxes/$TEST_INBOX_ID" "200" "Delete test inbox"
fi

# ═══════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════
echo ""
echo "============================================"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}, $TOTAL total"
if [ "$FAIL" -eq 0 ]; then
  echo -e "🎉 ${GREEN}All tests passed!${NC}"
else
  echo -e "⚠️  ${RED}Some tests failed — check output above${NC}"
fi
echo "============================================"
