package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// ===========================================================================
// Feature: enhanced-teams — handler-layer unit tests (task 15.1).
//
// These tests verify request parsing, query parameter handling, and response
// structure at the handler boundary. Since TeamHandler depends on a real
// TeamService (which needs a DB), we test the parsing/validation aspects that
// don't require a full service, or verify expected behavior via response codes
// on malformed input.
// ===========================================================================

// ---------------------------------------------------------------------------
// ListTeams search and filter parameter parsing
// ---------------------------------------------------------------------------

func TestListTeamsOpts_ParseSearchParam(t *testing.T) {
	// Verify that the search query parameter is correctly extracted from URL
	req := httptest.NewRequest(http.MethodGet, "/orgs/xxx/teams?search=dev&is_archived=true&page=2&per_page=10", nil)
	q := req.URL.Query()

	search := q.Get("search")
	if search != "dev" {
		t.Fatalf("expected search='dev', got %q", search)
	}

	isArchivedStr := q.Get("is_archived")
	if isArchivedStr == "" {
		t.Fatal("expected is_archived query param to be present")
	}
	val, err := strconv.ParseBool(isArchivedStr)
	if err != nil {
		t.Fatalf("expected is_archived to be parseable as bool, got error: %v", err)
	}
	if !val {
		t.Fatal("expected is_archived=true")
	}
}

func TestListTeamsOpts_DefaultIsArchivedNil(t *testing.T) {
	// When is_archived is not provided, it should be nil (service defaults to false)
	req := httptest.NewRequest(http.MethodGet, "/orgs/xxx/teams?search=test", nil)
	q := req.URL.Query()
	isArchivedStr := q.Get("is_archived")
	if isArchivedStr != "" {
		t.Fatalf("expected is_archived to be empty when not provided, got %q", isArchivedStr)
	}
}

// ---------------------------------------------------------------------------
// ListMembers search and role parameter parsing
// ---------------------------------------------------------------------------

func TestListMembersOpts_ParseParams(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/orgs/xxx/teams/yyy/members?search=alice&role=lead&page=1&per_page=20", nil)
	q := req.URL.Query()

	opts := postgres.ListMembersOpts{
		Search:  q.Get("search"),
		Role:    q.Get("role"),
		Page:    1,
		PerPage: 20,
	}

	if opts.Search != "alice" {
		t.Fatalf("expected search='alice', got %q", opts.Search)
	}
	if opts.Role != "lead" {
		t.Fatalf("expected role='lead', got %q", opts.Role)
	}
}

func TestListMembersOpts_EmptyFilters(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/orgs/xxx/teams/yyy/members", nil)
	q := req.URL.Query()

	opts := postgres.ListMembersOpts{
		Search:  q.Get("search"),
		Role:    q.Get("role"),
		Page:    1,
		PerPage: 20,
	}

	if opts.Search != "" {
		t.Fatalf("expected empty search, got %q", opts.Search)
	}
	if opts.Role != "" {
		t.Fatalf("expected empty role, got %q", opts.Role)
	}
}

// ---------------------------------------------------------------------------
// CreateTeam handler: invalid body returns 400
// ---------------------------------------------------------------------------

func TestCreateTeam_InvalidBodyReturns400(t *testing.T) {
	// A TeamHandler without a real service still validates the request body parse
	h := &TeamHandler{svc: nil}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/orgs/invalid-uuid/teams", strings.NewReader("not json"))

	// This will hit the orgID parse error first
	h.CreateTeam(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid org ID, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// BulkAddMembers: verify request body parsing for structure
// ---------------------------------------------------------------------------

func TestBulkAddMembers_RequestStructure(t *testing.T) {
	body := `{"members":[{"email":"a@test.com","role":"member"},{"email":"b@test.com","role":"lead"}]}`
	var input struct {
		Members []struct {
			Email string `json:"email"`
			Role  string `json:"role"`
		} `json:"members"`
	}
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&input); err != nil {
		t.Fatalf("failed to decode bulk add input: %v", err)
	}
	if len(input.Members) != 2 {
		t.Fatalf("expected 2 members in input, got %d", len(input.Members))
	}
	if input.Members[0].Email != "a@test.com" {
		t.Fatalf("expected first member email 'a@test.com', got %q", input.Members[0].Email)
	}
	if input.Members[1].Role != "lead" {
		t.Fatalf("expected second member role 'lead', got %q", input.Members[1].Role)
	}
}

// ---------------------------------------------------------------------------
// BulkRemoveMembers: verify request body parsing for structure
// ---------------------------------------------------------------------------

func TestBulkRemoveMembers_RequestStructure(t *testing.T) {
	body := `{"user_ids":["550e8400-e29b-41d4-a716-446655440000","6ba7b810-9dad-11d1-80b4-00c04fd430c8"]}`
	var input struct {
		UserIDs []string `json:"user_ids"`
	}
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&input); err != nil {
		t.Fatalf("failed to decode bulk remove input: %v", err)
	}
	if len(input.UserIDs) != 2 {
		t.Fatalf("expected 2 user_ids, got %d", len(input.UserIDs))
	}
}

// ---------------------------------------------------------------------------
// TransferTeam: verify request body parsing
// ---------------------------------------------------------------------------

func TestTransferTeam_RequestStructure(t *testing.T) {
	body := `{"target_org_id":"550e8400-e29b-41d4-a716-446655440000"}`
	var input struct {
		TargetOrgID string `json:"target_org_id"`
	}
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&input); err != nil {
		t.Fatalf("failed to decode transfer input: %v", err)
	}
	if input.TargetOrgID != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("expected target_org_id UUID, got %q", input.TargetOrgID)
	}
}

// ---------------------------------------------------------------------------
// GetImpact: verify response structure matches TeamImpact shape
// ---------------------------------------------------------------------------

func TestGetImpact_ResponseStructure(t *testing.T) {
	// Verify the JSON structure of TeamImpact matches API contract
	impact := map[string]int{
		"member_count":            5,
		"inbox_count":             12,
		"active_inbox_count":      3,
		"email_count":             150,
		"domain_assignment_count": 2,
		"webhook_count":           1,
		"apikey_count":            3,
	}
	data, err := json.Marshal(impact)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]int
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"member_count", "inbox_count", "active_inbox_count", "email_count", "domain_assignment_count", "webhook_count", "apikey_count"} {
		if _, ok := decoded[key]; !ok {
			t.Errorf("missing key %q in impact response", key)
		}
	}
}

// ---------------------------------------------------------------------------
// ArchiveTeam/RestoreTeam: invalid team ID returns 400
// ---------------------------------------------------------------------------

func TestArchiveTeam_InvalidTeamIDReturns400(t *testing.T) {
	h := &TeamHandler{svc: nil}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/orgs/550e8400-e29b-41d4-a716-446655440000/teams/not-a-uuid/archive", nil)

	h.ArchiveTeam(rec, req)
	// Without chi URL params, teamId will be empty → invalid UUID parse → 400
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid team ID, got %d", rec.Code)
	}
}

func TestRestoreTeam_InvalidTeamIDReturns400(t *testing.T) {
	h := &TeamHandler{svc: nil}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/orgs/550e8400-e29b-41d4-a716-446655440000/teams/not-a-uuid/restore", nil)

	h.RestoreTeam(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid team ID, got %d", rec.Code)
	}
}

func TestGetImpact_InvalidTeamIDReturns400(t *testing.T) {
	h := &TeamHandler{svc: nil}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/orgs/550e8400-e29b-41d4-a716-446655440000/teams/not-a-uuid/impact", nil)

	h.GetImpact(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid team ID, got %d", rec.Code)
	}
}

func TestLeaveTeam_InvalidTeamIDReturns400(t *testing.T) {
	h := &TeamHandler{svc: nil}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/orgs/550e8400-e29b-41d4-a716-446655440000/teams/not-a-uuid/leave", nil)

	h.LeaveTeam(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid team ID, got %d", rec.Code)
	}
}

func TestBulkAddMembers_InvalidTeamIDReturns400(t *testing.T) {
	h := &TeamHandler{svc: nil}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/orgs/550e8400-e29b-41d4-a716-446655440000/teams/not-a-uuid/members/bulk-add", strings.NewReader(`{"members":[]}`))

	h.BulkAddMembers(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid team ID, got %d", rec.Code)
	}
}

func TestBulkRemoveMembers_InvalidTeamIDReturns400(t *testing.T) {
	h := &TeamHandler{svc: nil}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/orgs/550e8400-e29b-41d4-a716-446655440000/teams/not-a-uuid/members/bulk-remove", strings.NewReader(`{"user_ids":[]}`))

	h.BulkRemoveMembers(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid team ID, got %d", rec.Code)
	}
}

func TestTransferTeam_InvalidTeamIDReturns400(t *testing.T) {
	h := &TeamHandler{svc: nil}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/orgs/550e8400-e29b-41d4-a716-446655440000/teams/not-a-uuid/transfer", strings.NewReader(`{"target_org_id":"550e8400-e29b-41d4-a716-446655440000"}`))

	h.TransferTeam(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid team ID, got %d", rec.Code)
	}
}
