package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

type OrgRepo struct {
	db database.DBTX
}

func NewOrgRepo(db database.DBTX) *OrgRepo {
	return &OrgRepo{db: db}
}

func (r *OrgRepo) WithTx(tx database.DBTX) *OrgRepo {
	return &OrgRepo{db: tx}
}

// ── Org CRUD ──

func (r *OrgRepo) Create(ctx context.Context, o *domain.Organization) error {
	settings, _ := json.Marshal(o.Settings)
	_, err := r.db.Exec(ctx,
		`INSERT INTO organizations (id, name, slug, logo_url, settings) VALUES ($1, $2, $3, $4, $5)`,
		o.ID, o.Name, o.Slug, o.LogoURL, settings)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create org: %w", err)
	}
	return nil
}

func (r *OrgRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Organization, error) {
	var o domain.Organization
	var settings []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, name, slug, logo_url, settings, created_at, updated_at FROM organizations WHERE id = $1`, id).
		Scan(&o.ID, &o.Name, &o.Slug, &o.LogoURL, &settings, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get org: %w", err)
	}
	_ = json.Unmarshal(settings, &o.Settings)
	return &o, nil
}

func (r *OrgRepo) GetBySlug(ctx context.Context, slug string) (*domain.Organization, error) {
	var o domain.Organization
	var settings []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, name, slug, logo_url, settings, created_at, updated_at FROM organizations WHERE slug = $1`, slug).
		Scan(&o.ID, &o.Name, &o.Slug, &o.LogoURL, &settings, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get org by slug: %w", err)
	}
	_ = json.Unmarshal(settings, &o.Settings)
	return &o, nil
}

func (r *OrgRepo) Update(ctx context.Context, o *domain.Organization) error {
	settings, _ := json.Marshal(o.Settings)
	_, err := r.db.Exec(ctx,
		`UPDATE organizations SET name=$1, slug=$2, logo_url=$3, settings=$4 WHERE id=$5`,
		o.Name, o.Slug, o.LogoURL, settings, o.ID)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("update org: %w", err)
	}
	return nil
}

func (r *OrgRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, id)
	return err
}

func (r *OrgRepo) ListByUser(ctx context.Context, userID uuid.UUID, page, perPage int) ([]domain.Organization, int, error) {
	var total int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM org_memberships WHERE user_id = $1`, userID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count orgs: %w", err)
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT o.id, o.name, o.slug, o.logo_url, o.settings, o.created_at, o.updated_at
		 FROM organizations o
		 JOIN org_memberships om ON o.id = om.org_id
		 WHERE om.user_id = $1
		 ORDER BY o.name
		 LIMIT $2 OFFSET $3`, userID, perPage, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list orgs: %w", err)
	}
	defer rows.Close()

	var orgs []domain.Organization
	for rows.Next() {
		var o domain.Organization
		var settings []byte
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.LogoURL, &settings, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, 0, err
		}
		_ = json.Unmarshal(settings, &o.Settings)
		orgs = append(orgs, o)
	}
	return orgs, total, nil
}

func (r *OrgRepo) Count(ctx context.Context) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM organizations`).Scan(&count)
	return count, err
}

// ── Membership CRUD ──

func (r *OrgRepo) CreateMembership(ctx context.Context, m *domain.OrgMembership) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO org_memberships (id, user_id, org_id, role) VALUES ($1, $2, $3, $4)`,
		m.ID, m.UserID, m.OrgID, m.Role)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create membership: %w", err)
	}
	return nil
}

func (r *OrgRepo) GetMembership(ctx context.Context, userID, orgID uuid.UUID) (*domain.OrgMembership, error) {
	var m domain.OrgMembership
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, org_id, role, created_at FROM org_memberships WHERE user_id = $1 AND org_id = $2`,
		userID, orgID).Scan(&m.ID, &m.UserID, &m.OrgID, &m.Role, &m.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get membership: %w", err)
	}
	return &m, nil
}

func (r *OrgRepo) ListMembers(ctx context.Context, orgID uuid.UUID, page, perPage int) ([]domain.OrgMembership, int, error) {
	var total int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM org_memberships WHERE org_id = $1`, orgID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT om.id, om.user_id, om.org_id, om.role, om.created_at, u.email, u.display_name,
		        (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = om.user_id) AS last_login_at
		 FROM org_memberships om JOIN users u ON om.user_id = u.id
		 WHERE om.org_id = $1 ORDER BY om.created_at LIMIT $2 OFFSET $3`, orgID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var members []domain.OrgMembership
	for rows.Next() {
		var m domain.OrgMembership
		if err := rows.Scan(&m.ID, &m.UserID, &m.OrgID, &m.Role, &m.CreatedAt, &m.Email, &m.DisplayName, &m.LastLoginAt); err != nil {
			return nil, 0, err
		}
		members = append(members, m)
	}
	return members, total, nil
}

func (r *OrgRepo) UpdateMemberRole(ctx context.Context, userID, orgID uuid.UUID, role string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE org_memberships SET role = $1 WHERE user_id = $2 AND org_id = $3`, role, userID, orgID)
	if err != nil {
		return fmt.Errorf("update role: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *OrgRepo) DeleteMembership(ctx context.Context, userID, orgID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM org_memberships WHERE user_id = $1 AND org_id = $2`, userID, orgID)
	return err
}

func (r *OrgRepo) CountOwners(ctx context.Context, orgID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM org_memberships WHERE org_id = $1 AND role = 'owner'`, orgID).Scan(&count)
	return count, err
}

// ── Invites ──

func (r *OrgRepo) CreateInvite(ctx context.Context, inv *domain.Invite) error {
	allowedAuth, _ := json.Marshal(inv.AllowedAuth)
	if len(inv.AllowedAuth) == 0 {
		allowedAuth = []byte(`["any"]`)
	}
	_, err := r.db.Exec(ctx,
		`INSERT INTO invites (id, org_id, team_id, email, org_role, team_role, token, invited_by, expires_at, allowed_auth)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		inv.ID, inv.OrgID, inv.TeamID, inv.Email, inv.OrgRole, inv.TeamRole, HashToken(inv.Token), inv.InvitedBy, inv.ExpiresAt, allowedAuth)
	if err != nil {
		return fmt.Errorf("create invite: %w", err)
	}
	return nil
}

func (r *OrgRepo) GetInviteByToken(ctx context.Context, token string) (*domain.Invite, error) {
	var inv domain.Invite
	var allowedAuth []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, org_id, team_id, email, org_role, team_role, token, invited_by, accepted_at, expires_at, created_at, allowed_auth
		 FROM invites WHERE token = $1`, HashToken(token)).
		Scan(&inv.ID, &inv.OrgID, &inv.TeamID, &inv.Email, &inv.OrgRole, &inv.TeamRole,
			&inv.Token, &inv.InvitedBy, &inv.AcceptedAt, &inv.ExpiresAt, &inv.CreatedAt, &allowedAuth)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get invite: %w", err)
	}
	if len(allowedAuth) > 0 {
		_ = json.Unmarshal(allowedAuth, &inv.AllowedAuth)
	}
	return &inv, nil
}

func (r *OrgRepo) MarkInviteAccepted(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE invites SET accepted_at = NOW() WHERE id = $1`, id)
	return err
}

func (r *OrgRepo) DeleteInvite(ctx context.Context, orgID, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM invites WHERE id = $1 AND org_id = $2`, id, orgID)
	return err
}

func (r *OrgRepo) GetInviteByID(ctx context.Context, id uuid.UUID) (*domain.Invite, error) {
	var inv domain.Invite
	var allowedAuth []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, org_id, team_id, email, org_role, team_role, token, invited_by, accepted_at, expires_at, created_at, allowed_auth
		 FROM invites WHERE id = $1`, id).
		Scan(&inv.ID, &inv.OrgID, &inv.TeamID, &inv.Email, &inv.OrgRole, &inv.TeamRole,
			&inv.Token, &inv.InvitedBy, &inv.AcceptedAt, &inv.ExpiresAt, &inv.CreatedAt, &allowedAuth)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get invite by id: %w", err)
	}
	if len(allowedAuth) > 0 {
		_ = json.Unmarshal(allowedAuth, &inv.AllowedAuth)
	}
	return &inv, nil
}

func (r *OrgRepo) DeletePendingInviteByEmail(ctx context.Context, orgID uuid.UUID, email string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM invites WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL`, orgID, email)
	return err
}

func (r *OrgRepo) ListPendingInvites(ctx context.Context, orgID uuid.UUID) ([]domain.Invite, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, org_id, team_id, email, org_role, team_role, invited_by, expires_at, created_at, allowed_auth
		 FROM invites WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
		 ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list pending invites: %w", err)
	}
	defer rows.Close()
	var invites []domain.Invite
	for rows.Next() {
		var inv domain.Invite
		var allowedAuth []byte
		if err := rows.Scan(&inv.ID, &inv.OrgID, &inv.TeamID, &inv.Email, &inv.OrgRole, &inv.TeamRole, &inv.InvitedBy, &inv.ExpiresAt, &inv.CreatedAt, &allowedAuth); err != nil {
			return nil, err
		}
		if len(allowedAuth) > 0 {
			_ = json.Unmarshal(allowedAuth, &inv.AllowedAuth)
		}
		invites = append(invites, inv)
	}
	return invites, nil
}

func (r *OrgRepo) SearchMembers(ctx context.Context, orgID uuid.UUID, query string, excludeTeamID *uuid.UUID, limit int) ([]domain.OrgMemberSuggestion, error) {
	if limit <= 0 {
		limit = 10
	}
	pattern := "%" + query + "%"

	var sql string
	var args []any

	if excludeTeamID != nil {
		sql = `SELECT u.id, u.email, u.display_name, u.avatar_url
		       FROM org_memberships om
		       JOIN users u ON om.user_id = u.id
		       WHERE om.org_id = $1
		         AND (u.email ILIKE $2 OR u.display_name ILIKE $2)
		         AND u.id NOT IN (SELECT user_id FROM team_memberships WHERE team_id = $3)
		       ORDER BY
		         CASE WHEN LOWER(u.email) = LOWER($4) THEN 0 ELSE 1 END,
		         CASE WHEN u.display_name ILIKE $2 THEN 0 ELSE 1 END,
		         CASE WHEN u.email ILIKE $2 THEN 0 ELSE 1 END,
		         u.display_name
		       LIMIT $5`
		args = []any{orgID, pattern, *excludeTeamID, query, limit}
	} else {
		sql = `SELECT u.id, u.email, u.display_name, u.avatar_url
		       FROM org_memberships om
		       JOIN users u ON om.user_id = u.id
		       WHERE om.org_id = $1
		         AND (u.email ILIKE $2 OR u.display_name ILIKE $2)
		       ORDER BY
		         CASE WHEN LOWER(u.email) = LOWER($3) THEN 0 ELSE 1 END,
		         CASE WHEN u.display_name ILIKE $2 THEN 0 ELSE 1 END,
		         CASE WHEN u.email ILIKE $2 THEN 0 ELSE 1 END,
		         u.display_name
		       LIMIT $4`
		args = []any{orgID, pattern, query, limit}
	}

	rows, err := r.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("search members: %w", err)
	}
	defer rows.Close()

	var results []domain.OrgMemberSuggestion
	for rows.Next() {
		var s domain.OrgMemberSuggestion
		if err := rows.Scan(&s.UserID, &s.Email, &s.DisplayName, &s.AvatarURL); err != nil {
			return nil, fmt.Errorf("scan member suggestion: %w", err)
		}
		results = append(results, s)
	}
	if results == nil {
		results = []domain.OrgMemberSuggestion{}
	}
	return results, nil
}

func (r *OrgRepo) ListAll(ctx context.Context, page, perPage int) ([]domain.Organization, int, error) {
	var total int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM organizations`).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count orgs: %w", err)
	}
	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT id, name, slug, logo_url, settings, created_at, updated_at
		 FROM organizations ORDER BY name LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list orgs: %w", err)
	}
	defer rows.Close()
	var orgs []domain.Organization
	for rows.Next() {
		var o domain.Organization
		var settings []byte
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.LogoURL, &settings, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, 0, err
		}
		if len(settings) > 0 {
			_ = json.Unmarshal(settings, &o.Settings)
		}
		orgs = append(orgs, o)
	}
	return orgs, total, nil
}

// ── Invite Team Assignments ──

func (r *OrgRepo) CreateInviteTeamAssignments(ctx context.Context, inviteID uuid.UUID, assignments []domain.InviteTeamAssign) error {
	for _, a := range assignments {
		_, err := r.db.Exec(ctx,
			`INSERT INTO invite_team_assignments (id, invite_id, team_id, team_role)
			 VALUES ($1, $2, $3, $4)`,
			uuid.New(), inviteID, a.TeamID, a.TeamRole)
		if err != nil {
			if isUniqueViolation(err) {
				return ErrConflict
			}
			return fmt.Errorf("create invite team assignment: %w", err)
		}
	}
	return nil
}

func (r *OrgRepo) GetInviteTeamAssignments(ctx context.Context, inviteID uuid.UUID) ([]domain.InviteTeamAssign, error) {
	rows, err := r.db.Query(ctx,
		`SELECT ita.team_id, ita.team_role, t.name
		 FROM invite_team_assignments ita
		 JOIN teams t ON ita.team_id = t.id
		 WHERE ita.invite_id = $1
		 ORDER BY ita.created_at`, inviteID)
	if err != nil {
		return nil, fmt.Errorf("get invite team assignments: %w", err)
	}
	defer rows.Close()

	var assignments []domain.InviteTeamAssign
	for rows.Next() {
		var a domain.InviteTeamAssign
		if err := rows.Scan(&a.TeamID, &a.TeamRole, &a.TeamName); err != nil {
			return nil, err
		}
		assignments = append(assignments, a)
	}
	return assignments, nil
}

func (r *OrgRepo) GetPendingInviteByEmail(ctx context.Context, email string) (*domain.Invite, error) {
	var inv domain.Invite
	var allowedAuth []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, org_id, team_id, email, org_role, team_role, token, invited_by, accepted_at, expires_at, created_at, allowed_auth
		 FROM invites
		 WHERE email = $1 AND accepted_at IS NULL AND expires_at > NOW()
		 ORDER BY created_at DESC
		 LIMIT 1`, email).
		Scan(&inv.ID, &inv.OrgID, &inv.TeamID, &inv.Email, &inv.OrgRole, &inv.TeamRole,
			&inv.Token, &inv.InvitedBy, &inv.AcceptedAt, &inv.ExpiresAt, &inv.CreatedAt, &allowedAuth)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get pending invite by email: %w", err)
	}
	if len(allowedAuth) > 0 {
		_ = json.Unmarshal(allowedAuth, &inv.AllowedAuth)
	}
	return &inv, nil
}

func (r *OrgRepo) FindPendingInvitesWithTeamAssignment(ctx context.Context, teamID uuid.UUID) ([]domain.Invite, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT i.id, i.org_id, i.team_id, i.email, i.org_role, i.team_role, i.invited_by, i.expires_at, i.created_at, i.allowed_auth
		 FROM invites i
		 JOIN invite_team_assignments ita ON i.id = ita.invite_id
		 WHERE ita.team_id = $1 AND i.accepted_at IS NULL AND i.expires_at > NOW()
		 ORDER BY i.created_at DESC`, teamID)
	if err != nil {
		return nil, fmt.Errorf("find pending invites with team assignment: %w", err)
	}
	defer rows.Close()

	var invites []domain.Invite
	for rows.Next() {
		var inv domain.Invite
		var allowedAuth []byte
		if err := rows.Scan(&inv.ID, &inv.OrgID, &inv.TeamID, &inv.Email, &inv.OrgRole, &inv.TeamRole, &inv.InvitedBy, &inv.ExpiresAt, &inv.CreatedAt, &allowedAuth); err != nil {
			return nil, err
		}
		if len(allowedAuth) > 0 {
			_ = json.Unmarshal(allowedAuth, &inv.AllowedAuth)
		}
		invites = append(invites, inv)
	}
	return invites, nil
}

func (r *OrgRepo) CountInviteTeamAssignments(ctx context.Context, inviteID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM invite_team_assignments WHERE invite_id = $1`, inviteID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count invite team assignments: %w", err)
	}
	return count, nil
}

func (r *OrgRepo) DeleteInviteTeamAssignment(ctx context.Context, inviteID uuid.UUID, teamID uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`DELETE FROM invite_team_assignments WHERE invite_id = $1 AND team_id = $2`, inviteID, teamID)
	if err != nil {
		return fmt.Errorf("delete invite team assignment: %w", err)
	}
	return nil
}

func (r *OrgRepo) RevokePendingInvitesByLegacyTeamID(ctx context.Context, teamID uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`DELETE FROM invites WHERE team_id = $1 AND accepted_at IS NULL`, teamID)
	if err != nil {
		return fmt.Errorf("revoke pending invites by legacy team id: %w", err)
	}
	return nil
}

// FindExpiringInvites returns pending invites that expire within the given window.
func (r *OrgRepo) FindExpiringInvites(ctx context.Context, window time.Duration) ([]domain.Invite, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, org_id, team_id, email, org_role, team_role, invited_by, expires_at, created_at, allowed_auth
		 FROM invites
		 WHERE accepted_at IS NULL AND expires_at BETWEEN NOW() AND NOW() + $1::interval
		 ORDER BY expires_at ASC`, window)
	if err != nil {
		return nil, fmt.Errorf("find expiring invites: %w", err)
	}
	defer rows.Close()
	var invites []domain.Invite
	for rows.Next() {
		var inv domain.Invite
		var allowedAuth []byte
		if err := rows.Scan(&inv.ID, &inv.OrgID, &inv.TeamID, &inv.Email, &inv.OrgRole, &inv.TeamRole, &inv.InvitedBy, &inv.ExpiresAt, &inv.CreatedAt, &allowedAuth); err != nil {
			return nil, err
		}
		if len(allowedAuth) > 0 {
			_ = json.Unmarshal(allowedAuth, &inv.AllowedAuth)
		}
		invites = append(invites, inv)
	}
	return invites, nil
}
