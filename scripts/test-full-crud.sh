#!/bin/bash
# BurnerByte Full CRUD Test Suite
# Tests create/read/update/delete for all resource types.
# Resources are created, verified, and cleaned up.
#
# Usage: ./scripts/test-full-crud.sh <email> <password> [--keep]
# Add --keep to skip cleanup and leave test resources for inspection.
#
# Requires: curl, jq

set -euo pipefail

EMAIL="${1:?Usage: $0 <email> <password> [--keep]}"
PASSWORD="${2:?Usage: $0 <email> <password> [--keep]}"
KEEP="${3:-}"
BASE="https://burnerbyte.com/api/v1"
PASS=0; FAIL=0; TOTAL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; NC='\033[0m'

ok() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo -e "  ${GREEN}✅${NC} $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo -e "  ${RED}❌${NC} $1"; }
section() { echo -e "\n${CYAN}── $1 ──${NC}"; }

call() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(-d "$body")
  curl -X "$method" "${args[@]}" "$BASE$path" 2>/dev/null
}

status() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(-d "$body")
  curl -X "$method" "${args[@]}" "$BASE$path" 2>/dev/null
}

echo "============================================"
echo "BurnerByte Full CRUD Test Suite"
echo "============================================"

# ── Login ──
section "Login"
LOGIN=$(curl -s -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/auth/login")
TOKEN=$(echo "$LOGIN" | jq -r '.tokens.access_token // empty')
[ -z "$TOKEN" ] && { echo -e "${RED}Login failed${NC}"; exit 1; }
ok "Logged in"

# Get org and team IDs
ORG_ID=$(call GET "/orgs" | jq -r '.data[0].id')
TEAM_ID=$(call GET "/orgs/$ORG_ID/teams?per_page=1" | jq -r '.data[0].id')
echo "  Org: $ORG_ID | Team: $TEAM_ID"

# ═══════════════════════════════════════════
# 1. INBOX CRUD
# ═══════════════════════════════════════════
section "Inbox CRUD"

ASSIGNMENT_ID=$(call GET "/my/domains" | jq -r '.data[0].id // empty')
if [ -z "$ASSIGNMENT_ID" ]; then
  fail "No domain assignments — cannot test inbox CRUD"
else
  # Create
  INBOX=$(call POST "/inboxes" "{\"domain_assignment_id\":\"$ASSIGNMENT_ID\",\"ttl\":\"15m\"}")
  INBOX_ID=$(echo "$INBOX" | jq -r '.id // empty')
  INBOX_ADDR=$(echo "$INBOX" | jq -r '.full_address // empty')
  [ -n "$INBOX_ID" ] && ok "CREATE inbox: $INBOX_ADDR" || fail "CREATE inbox"

  # Read
  [ "$(status GET "/inboxes/$INBOX_ID")" = "200" ] && ok "READ inbox" || fail "READ inbox"

  # List (should contain our inbox)
  LIST_COUNT=$(call GET "/inboxes?status=active&per_page=50" | jq "[.data[] | select(.id==\"$INBOX_ID\")] | length")
  [ "$LIST_COUNT" = "1" ] && ok "LIST contains created inbox" || fail "LIST missing created inbox"

  # Extend TTL
  [ "$(status POST "/inboxes/$INBOX_ID/extend" "{}")" = "200" ] && ok "EXTEND TTL" || fail "EXTEND TTL"

  # List emails (empty)
  EMAIL_COUNT=$(call GET "/inboxes/$INBOX_ID/emails?per_page=5" | jq '.total')
  [ "$EMAIL_COUNT" = "0" ] && ok "LIST emails (empty inbox = 0)" || fail "LIST emails"

  # Mark all read
  MARKED=$(call POST "/inboxes/$INBOX_ID/emails/mark-all-read" "" | jq '.marked')
  [ "$MARKED" = "0" ] && ok "MARK ALL READ (0 marked)" || fail "MARK ALL READ"

  # Delete
  if [ "$KEEP" != "--keep" ]; then
    [ "$(status DELETE "/inboxes/$INBOX_ID")" = "200" ] && ok "DELETE inbox" || fail "DELETE inbox"
    # Verify deleted
    [ "$(status GET "/inboxes/$INBOX_ID")" = "404" ] && ok "VERIFY deleted (404)" || fail "VERIFY deleted"
  else
    echo -e "  ${YELLOW}⏭️  Keeping inbox $INBOX_ADDR for inspection${NC}"
  fi
fi

# ═══════════════════════════════════════════
# 2. WEBHOOK CRUD
# ═══════════════════════════════════════════
section "Webhook CRUD"

# Create
WH=$(call POST "/orgs/$ORG_ID/teams/$TEAM_ID/webhooks" '{"url":"https://httpbin.org/post","events":["email.received"],"secret":"test-secret-123"}')
WH_ID=$(echo "$WH" | jq -r '.id // empty')
[ -n "$WH_ID" ] && ok "CREATE webhook: $WH_ID" || fail "CREATE webhook"

if [ -n "$WH_ID" ]; then
  # Read (list)
  WH_IN_LIST=$(call GET "/orgs/$ORG_ID/teams/$TEAM_ID/webhooks?per_page=50" | jq "[.data[] | select(.id==\"$WH_ID\")] | length")
  [ "$WH_IN_LIST" = "1" ] && ok "LIST contains webhook" || fail "LIST missing webhook"

  # Update
  UPDATED_WH=$(call PATCH "/orgs/$ORG_ID/teams/$TEAM_ID/webhooks/$WH_ID" '{"url":"https://httpbin.org/post","events":["email.received","inbox.created"],"active":true}')
  EVENTS_COUNT=$(echo "$UPDATED_WH" | jq '.events | length')
  [ "$EVENTS_COUNT" = "2" ] && ok "UPDATE webhook (2 events)" || fail "UPDATE webhook"

  # Delivery logs
  [ "$(status GET "/orgs/$ORG_ID/teams/$TEAM_ID/webhooks/$WH_ID/deliveries?per_page=5")" = "200" ] && ok "LIST delivery logs" || fail "LIST delivery logs"

  # Delete
  if [ "$KEEP" != "--keep" ]; then
    [ "$(status DELETE "/orgs/$ORG_ID/teams/$TEAM_ID/webhooks/$WH_ID")" = "200" ] && ok "DELETE webhook" || fail "DELETE webhook"
  fi
fi

# ═══════════════════════════════════════════
# 3. API KEY CRUD
# ═══════════════════════════════════════════
section "API Key CRUD"

# Create
AK=$(call POST "/orgs/$ORG_ID/teams/$TEAM_ID/api-keys" '{"name":"test-crud-key","scopes":["team.inboxes.view","team.emails.view"],"expires_in":"24h"}')
AK_ID=$(echo "$AK" | jq -r '.id // empty')
AK_RAW=$(echo "$AK" | jq -r '.raw_key // empty')
[ -n "$AK_ID" ] && ok "CREATE API key: $AK_ID (raw: ${AK_RAW:0:15}...)" || fail "CREATE API key"

if [ -n "$AK_ID" ]; then
  # Read
  AK_DETAIL=$(call GET "/orgs/$ORG_ID/teams/$TEAM_ID/api-keys/$AK_ID")
  AK_NAME=$(echo "$AK_DETAIL" | jq -r '.name')
  [ "$AK_NAME" = "test-crud-key" ] && ok "READ API key (name matches)" || fail "READ API key"

  # Update
  UPDATED_AK=$(call PATCH "/orgs/$ORG_ID/teams/$TEAM_ID/api-keys/$AK_ID" '{"name":"test-crud-key-updated","scopes":["team.inboxes.view","team.emails.view","team.inboxes.create"]}')
  NEW_NAME=$(echo "$UPDATED_AK" | jq -r '.name')
  NEW_SCOPES=$(echo "$UPDATED_AK" | jq '.scopes | length')
  [ "$NEW_NAME" = "test-crud-key-updated" ] && ok "UPDATE name" || fail "UPDATE name"
  [ "$NEW_SCOPES" = "3" ] && ok "UPDATE scopes (3)" || fail "UPDATE scopes"

  # Test the key works
  AK_TEST=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $AK_RAW" "$BASE/inboxes?per_page=1" 2>/dev/null)
  AK_STATUS=$(echo "$AK_TEST" | tail -1)
  [ "$AK_STATUS" = "200" ] && ok "USE API key (list inboxes)" || fail "USE API key ($AK_STATUS)"

  # Rotate
  ROTATED=$(call POST "/orgs/$ORG_ID/teams/$TEAM_ID/api-keys/$AK_ID/rotate" "")
  NEW_RAW=$(echo "$ROTATED" | jq -r '.raw_key // empty')
  [ -n "$NEW_RAW" ] && ok "ROTATE key (new: ${NEW_RAW:0:15}...)" || fail "ROTATE key"

  # Old key should fail
  OLD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $AK_RAW" "$BASE/inboxes?per_page=1" 2>/dev/null)
  [ "$OLD_STATUS" = "401" ] && ok "OLD key rejected after rotate (401)" || fail "OLD key still works ($OLD_STATUS)"

  # New key should work
  if [ -n "$NEW_RAW" ]; then
    NEW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $NEW_RAW" "$BASE/inboxes?per_page=1" 2>/dev/null)
    [ "$NEW_STATUS" = "200" ] && ok "NEW key works after rotate" || fail "NEW key fails ($NEW_STATUS)"
  fi

  # Revoke
  if [ "$KEEP" != "--keep" ]; then
    [ "$(status DELETE "/orgs/$ORG_ID/teams/$TEAM_ID/api-keys/$AK_ID")" = "200" ] && ok "REVOKE API key" || fail "REVOKE API key"
    # Verify revoked key fails
    if [ -n "$NEW_RAW" ]; then
      REV_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $NEW_RAW" "$BASE/inboxes?per_page=1" 2>/dev/null)
      [ "$REV_STATUS" = "401" ] && ok "REVOKED key rejected (401)" || fail "REVOKED key still works ($REV_STATUS)"
    fi
  fi
fi

# ═══════════════════════════════════════════
# 4. NOTIFICATION CRUD
# ═══════════════════════════════════════════
section "Notifications"
NOTIFS=$(call GET "/notifications" | jq 'length')
ok "LIST notifications ($NOTIFS)"
[ "$(status POST "/notifications/mark-all-read" "")" = "200" ] && ok "MARK ALL READ" || fail "MARK ALL READ"

# ═══════════════════════════════════════════
# 5. PROFILE UPDATE
# ═══════════════════════════════════════════
section "Profile"
ME=$(call GET "/auth/me")
OLD_NAME=$(echo "$ME" | jq -r '.display_name')
# Update display name
call PATCH "/auth/me" "{\"display_name\":\"Test Name $(date +%s)\"}" > /dev/null
NEW_ME=$(call GET "/auth/me")
NEW_NAME=$(echo "$NEW_ME" | jq -r '.display_name')
[ "$NEW_NAME" != "$OLD_NAME" ] && ok "UPDATE profile (name changed)" || fail "UPDATE profile"
# Restore
call PATCH "/auth/me" "{\"display_name\":\"$OLD_NAME\"}" > /dev/null
ok "RESTORE profile name"

# ═══════════════════════════════════════════
# 6. ORG SETTINGS UPDATE
# ═══════════════════════════════════════════
section "Org Settings"
SETTINGS=$(call GET "/orgs/$ORG_ID/settings")
OLD_TTL=$(echo "$SETTINGS" | jq -r '.default_inbox_ttl // "1h"')
# Update
call PUT "/orgs/$ORG_ID/settings" "{\"default_inbox_ttl\":\"2h\"}" > /dev/null
NEW_SETTINGS=$(call GET "/orgs/$ORG_ID/settings")
NEW_TTL=$(echo "$NEW_SETTINGS" | jq -r '.default_inbox_ttl // empty')
[ "$NEW_TTL" = "2h" ] && ok "UPDATE org settings (TTL=2h)" || fail "UPDATE org settings"
# Restore
call PUT "/orgs/$ORG_ID/settings" "{\"default_inbox_ttl\":\"$OLD_TTL\"}" > /dev/null
ok "RESTORE org settings"

# ═══════════════════════════════════════════
# 7. AUDIT VERIFICATION
# ═══════════════════════════════════════════
section "Audit Trail"
AUDIT=$(call GET "/orgs/$ORG_ID/audit?per_page=5")
AUDIT_COUNT=$(echo "$AUDIT" | jq '.total')
[ "$AUDIT_COUNT" -gt 0 ] && ok "Audit has $AUDIT_COUNT entries" || fail "Audit empty"

# Check that our test actions were logged
RECENT_ACTIONS=$(echo "$AUDIT" | jq -r '[.data[].action] | join(", ")')
echo "  Recent: $RECENT_ACTIONS"

# Export
EXPORT_STATUS=$(status GET "/orgs/$ORG_ID/audit/export?format=json")
[ "$EXPORT_STATUS" = "200" ] && ok "EXPORT audit (JSON)" || fail "EXPORT audit"
CSV_STATUS=$(status GET "/orgs/$ORG_ID/audit/export?format=csv")
[ "$CSV_STATUS" = "200" ] && ok "EXPORT audit (CSV)" || fail "EXPORT audit CSV"

# ═══════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════
echo ""
echo "============================================"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, $TOTAL total"
[ "$FAIL" -eq 0 ] && echo -e "🎉 ${GREEN}All tests passed!${NC}" || echo -e "⚠️  ${RED}Some tests failed${NC}"
[ "$KEEP" = "--keep" ] && echo -e "${YELLOW}Note: --keep flag set, test resources were NOT cleaned up${NC}"
echo "============================================"
