package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

type TeamRepo struct {
	db database.DBTX
}

func NewTeamRepo(db database.DBTX) *TeamRepo {
	return &TeamRepo{db: db}
}

func (r *TeamRepo) WithTx(tx database.DBTX) *TeamRepo {
	return &TeamRepo{db: tx}
}

func (r *TeamRepo) Create(ctx context.Context, t *domain.Team) error {
	settings, _ := json.Marshal(t.Settings)
	_, err := r.db.Exec(ctx,
		`INSERT INTO teams (id, org_id, name, slug, description, avatar_url, settings) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		t.ID, t.OrgID, t.Name, t.Slug, t.Description, t.AvatarURL, settings)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create team: %w", err)
	}
	return nil
}

func (r *TeamRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Team, error) {
	var t domain.Team
	var settings []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, org_id, name, slug, description, avatar_url, is_archived, archived_at, settings, created_at, updated_at FROM teams WHERE id = $1`, id).
		Scan(&t.ID, &t.OrgID, &t.Name, &t.Slug, &t.Description, &t.AvatarURL, &t.IsArchived, &t.ArchivedAt, &settings, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(settings, &t.Settings)
	return &t, nil
}

// GetTeamOrgID returns the org a team belongs to. Used by the RBAC checker to
// bind a route's {teamId} to its {orgId}. Returns ErrNotFound if the team
// does not exist.
func (r *TeamRepo) GetTeamOrgID(ctx context.Context, teamID uuid.UUID) (uuid.UUID, error) {
	var orgID uuid.UUID
	err := r.db.QueryRow(ctx, `SELECT org_id FROM teams WHERE id = $1`, teamID).Scan(&orgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, err
	}
	return orgID, nil
}

func (r *TeamRepo) GetDetail(ctx context.Context, id uuid.UUID) (*domain.TeamDetail, error) {
	var td domain.TeamDetail
	var settings []byte
	err := r.db.QueryRow(ctx,
		`SELECT t.id, t.org_id, t.name, t.slug, t.description, t.avatar_url, t.is_archived, t.archived_at, t.settings, t.created_at, t.updated_at,
		        (SELECT COUNT(*) FROM team_memberships tm WHERE tm.team_id = t.id),
		        (SELECT COUNT(DISTINCT da.domain_id) FROM domain_assignments da WHERE da.team_id = t.id),
		        (SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = t.id AND i.is_active = TRUE),
		        (SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = t.id),
		        (SELECT COUNT(*) FROM emails e JOIN inboxes i ON e.inbox_id = i.id JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = t.id),
		        (SELECT COUNT(*) FROM webhooks wh WHERE wh.team_id = t.id),
		        (SELECT COUNT(*) FROM api_keys ak WHERE ak.team_id = t.id AND ak.revoked_at IS NULL)
		 FROM teams t WHERE t.id = $1`, id).
		Scan(&td.ID, &td.OrgID, &td.Name, &td.Slug, &td.Description, &td.AvatarURL, &td.IsArchived, &td.ArchivedAt, &settings, &td.CreatedAt, &td.UpdatedAt,
			&td.MemberCount, &td.DomainCount, &td.ActiveInboxes,
			&td.TotalInboxes, &td.EmailCount, &td.WebhookCount, &td.APIKeyCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(settings, &td.Settings)
	return &td, nil
}

// ListTeamsOpts holds filtering/pagination options for listing teams.
type ListTeamsOpts struct {
	Search     string
	IsArchived *bool
	Page       int
	PerPage    int
}

func (r *TeamRepo) ListByOrg(ctx context.Context, orgID uuid.UUID, opts ListTeamsOpts) ([]domain.Team, int, error) {
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PerPage < 1 || opts.PerPage > 100 {
		opts.PerPage = 20
	}

	// Build WHERE clause
	where := "WHERE t.org_id = $1"
	args := []any{orgID}
	argIdx := 2

	// Default to non-archived when not specified
	if opts.IsArchived != nil {
		where += fmt.Sprintf(" AND t.is_archived = $%d", argIdx)
		args = append(args, *opts.IsArchived)
		argIdx++
	}

	if opts.Search != "" {
		where += fmt.Sprintf(" AND t.name ILIKE $%d", argIdx)
		args = append(args, "%"+opts.Search+"%")
		argIdx++
	}

	// Count
	var total int
	countQuery := "SELECT COUNT(*) FROM teams t " + where
	err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Data query
	offset := (opts.Page - 1) * opts.PerPage
	dataQuery := fmt.Sprintf(
		`SELECT t.id, t.org_id, t.name, t.slug, t.description, t.avatar_url, t.is_archived, t.archived_at, t.settings, t.created_at, t.updated_at,
		        (SELECT COUNT(*) FROM team_memberships tm WHERE tm.team_id = t.id),
		        (SELECT COUNT(DISTINCT da.domain_id) FROM domain_assignments da WHERE da.team_id = t.id),
		        (SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = t.id AND i.is_active = TRUE)
		 FROM teams t %s ORDER BY t.name LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1)
	args = append(args, opts.PerPage, offset)

	rows, err := r.db.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var teams []domain.Team
	for rows.Next() {
		var t domain.Team
		var settings []byte
		if err := rows.Scan(&t.ID, &t.OrgID, &t.Name, &t.Slug, &t.Description, &t.AvatarURL, &t.IsArchived, &t.ArchivedAt, &settings, &t.CreatedAt, &t.UpdatedAt,
			&t.MemberCount, &t.DomainCount, &t.ActiveInboxes); err != nil {
			return nil, 0, err
		}
		_ = json.Unmarshal(settings, &t.Settings)
		teams = append(teams, t)
	}
	return teams, total, nil
}

func (r *TeamRepo) ListByUserMembership(ctx context.Context, orgID, userID uuid.UUID, opts ListTeamsOpts) ([]domain.Team, int, error) {
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PerPage < 1 || opts.PerPage > 100 {
		opts.PerPage = 20
	}

	// Build WHERE clause with membership join
	where := "WHERE t.org_id = $1 AND tm.user_id = $2"
	args := []any{orgID, userID}
	argIdx := 3

	if opts.IsArchived != nil {
		where += fmt.Sprintf(" AND t.is_archived = $%d", argIdx)
		args = append(args, *opts.IsArchived)
		argIdx++
	}

	if opts.Search != "" {
		where += fmt.Sprintf(" AND t.name ILIKE $%d", argIdx)
		args = append(args, "%"+opts.Search+"%")
		argIdx++
	}

	// Count
	var total int
	countQuery := "SELECT COUNT(*) FROM teams t JOIN team_memberships tm ON tm.team_id = t.id " + where
	err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Data query
	offset := (opts.Page - 1) * opts.PerPage
	dataQuery := fmt.Sprintf(
		`SELECT t.id, t.org_id, t.name, t.slug, t.description, t.avatar_url, t.is_archived, t.archived_at, t.settings, t.created_at, t.updated_at,
		        (SELECT COUNT(*) FROM team_memberships tm2 WHERE tm2.team_id = t.id),
		        (SELECT COUNT(DISTINCT da.domain_id) FROM domain_assignments da WHERE da.team_id = t.id),
		        (SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = t.id AND i.is_active = TRUE)
		 FROM teams t JOIN team_memberships tm ON tm.team_id = t.id %s ORDER BY t.name LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1)
	args = append(args, opts.PerPage, offset)

	rows, err := r.db.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var teams []domain.Team
	for rows.Next() {
		var t domain.Team
		var settings []byte
		if err := rows.Scan(&t.ID, &t.OrgID, &t.Name, &t.Slug, &t.Description, &t.AvatarURL, &t.IsArchived, &t.ArchivedAt, &settings, &t.CreatedAt, &t.UpdatedAt,
			&t.MemberCount, &t.DomainCount, &t.ActiveInboxes); err != nil {
			return nil, 0, err
		}
		_ = json.Unmarshal(settings, &t.Settings)
		teams = append(teams, t)
	}
	return teams, total, nil
}

func (r *TeamRepo) Update(ctx context.Context, t *domain.Team) error {
	settings, _ := json.Marshal(t.Settings)
	_, err := r.db.Exec(ctx,
		`UPDATE teams SET name=$1, slug=$2, description=$3, avatar_url=$4, settings=$5 WHERE id=$6`,
		t.Name, t.Slug, t.Description, t.AvatarURL, settings, t.ID)
	return err
}

func (r *TeamRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM teams WHERE id = $1`, id)
	return err
}

func (r *TeamRepo) CountByOrg(ctx context.Context, orgID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM teams WHERE org_id = $1`, orgID).Scan(&count)
	return count, err
}

func (r *TeamRepo) SetArchived(ctx context.Context, id uuid.UUID, archived bool) error {
	if archived {
		_, err := r.db.Exec(ctx, `UPDATE teams SET is_archived = TRUE, archived_at = NOW() WHERE id = $1`, id)
		return err
	}
	_, err := r.db.Exec(ctx, `UPDATE teams SET is_archived = FALSE, archived_at = NULL WHERE id = $1`, id)
	return err
}

func (r *TeamRepo) GetImpact(ctx context.Context, id uuid.UUID) (*domain.TeamImpact, error) {
	var impact domain.TeamImpact
	err := r.db.QueryRow(ctx,
		`SELECT
		    (SELECT COUNT(*) FROM team_memberships WHERE team_id = $1),
		    (SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = $1),
		    (SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = $1 AND i.is_active = TRUE),
		    (SELECT COUNT(*) FROM emails e JOIN inboxes i ON e.inbox_id = i.id JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = $1),
		    (SELECT COUNT(*) FROM domain_assignments WHERE team_id = $1),
		    (SELECT COUNT(*) FROM webhooks WHERE team_id = $1),
		    (SELECT COUNT(*) FROM api_keys WHERE team_id = $1 AND revoked_at IS NULL)`,
		id).Scan(&impact.MemberCount, &impact.InboxCount, &impact.ActiveInboxCount, &impact.EmailCount,
		&impact.DomainAssignmentCount, &impact.WebhookCount, &impact.APIKeyCount)
	if err != nil {
		return nil, err
	}
	return &impact, nil
}

func (r *TeamRepo) CountLeads(ctx context.Context, teamID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM team_memberships WHERE team_id = $1 AND role = 'lead'`, teamID).Scan(&count)
	return count, err
}

// ListMembersOpts holds filtering/pagination options for listing team members.
type ListMembersOpts struct {
	Search  string
	Role    string
	Page    int
	PerPage int
}

func (r *TeamRepo) ListMembersFiltered(ctx context.Context, teamID uuid.UUID, opts ListMembersOpts) ([]domain.TeamMembership, int, error) {
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PerPage < 1 || opts.PerPage > 100 {
		opts.PerPage = 20
	}

	where := "WHERE tm.team_id = $1"
	args := []any{teamID}
	argIdx := 2

	if opts.Role != "" {
		where += fmt.Sprintf(" AND tm.role = $%d", argIdx)
		args = append(args, opts.Role)
		argIdx++
	}
	if opts.Search != "" {
		where += fmt.Sprintf(" AND (u.email ILIKE $%d OR u.display_name ILIKE $%d)", argIdx, argIdx)
		args = append(args, "%"+opts.Search+"%")
		argIdx++
	}

	var total int
	countQuery := "SELECT COUNT(*) FROM team_memberships tm JOIN users u ON tm.user_id = u.id " + where
	err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (opts.Page - 1) * opts.PerPage
	dataQuery := fmt.Sprintf(
		`SELECT tm.id, tm.user_id, tm.team_id, tm.role, tm.created_at, u.email, u.display_name
		 FROM team_memberships tm JOIN users u ON tm.user_id = u.id
		 %s ORDER BY tm.created_at LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1)
	args = append(args, opts.PerPage, offset)

	rows, err := r.db.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var members []domain.TeamMembership
	for rows.Next() {
		var m domain.TeamMembership
		if err := rows.Scan(&m.ID, &m.UserID, &m.TeamID, &m.Role, &m.CreatedAt, &m.Email, &m.DisplayName); err != nil {
			return nil, 0, err
		}
		members = append(members, m)
	}
	return members, total, nil
}

func (r *TeamRepo) RemoveDomainAssignments(ctx context.Context, teamID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM domain_assignments WHERE team_id = $1`, teamID)
	return err
}

func (r *TeamRepo) ListMemberUserIDs(ctx context.Context, teamID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `SELECT user_id FROM team_memberships WHERE team_id = $1`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func (r *TeamRepo) BulkDeleteMemberships(ctx context.Context, teamID uuid.UUID, userIDs []uuid.UUID) error {
	if len(userIDs) == 0 {
		return nil
	}
	// Build placeholders
	placeholders := make([]string, len(userIDs))
	args := []any{teamID}
	for i, uid := range userIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+2)
		args = append(args, uid)
	}
	query := fmt.Sprintf(`DELETE FROM team_memberships WHERE team_id = $1 AND user_id IN (%s)`, strings.Join(placeholders, ","))
	_, err := r.db.Exec(ctx, query, args...)
	return err
}

// ── Team Memberships ──

func (r *TeamRepo) CreateMembership(ctx context.Context, m *domain.TeamMembership) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO team_memberships (id, user_id, team_id, role) VALUES ($1, $2, $3, $4)`,
		m.ID, m.UserID, m.TeamID, m.Role)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create team membership: %w", err)
	}
	return nil
}

func (r *TeamRepo) GetMembership(ctx context.Context, userID, teamID uuid.UUID) (*domain.TeamMembership, error) {
	var m domain.TeamMembership
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, team_id, role, created_at FROM team_memberships WHERE user_id = $1 AND team_id = $2`,
		userID, teamID).Scan(&m.ID, &m.UserID, &m.TeamID, &m.Role, &m.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &m, nil
}

func (r *TeamRepo) ListMembers(ctx context.Context, teamID uuid.UUID, page, perPage int) ([]domain.TeamMembership, int, error) {
	var total int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM team_memberships WHERE team_id = $1`, teamID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT tm.id, tm.user_id, tm.team_id, tm.role, tm.created_at, u.email, u.display_name
		 FROM team_memberships tm JOIN users u ON tm.user_id = u.id
		 WHERE tm.team_id = $1 ORDER BY tm.created_at LIMIT $2 OFFSET $3`, teamID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var members []domain.TeamMembership
	for rows.Next() {
		var m domain.TeamMembership
		if err := rows.Scan(&m.ID, &m.UserID, &m.TeamID, &m.Role, &m.CreatedAt, &m.Email, &m.DisplayName); err != nil {
			return nil, 0, err
		}
		members = append(members, m)
	}
	return members, total, nil
}

func (r *TeamRepo) UpdateMemberRole(ctx context.Context, userID, teamID uuid.UUID, role string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE team_memberships SET role = $1 WHERE user_id = $2 AND team_id = $3`, role, userID, teamID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *TeamRepo) DeleteMembership(ctx context.Context, userID, teamID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM team_memberships WHERE user_id = $1 AND team_id = $2`, userID, teamID)
	return err
}

func (r *TeamRepo) ExistsByNameInOrg(ctx context.Context, orgID uuid.UUID, name string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM teams WHERE org_id = $1 AND LOWER(name) = LOWER($2))`,
		orgID, name).Scan(&exists)
	return exists, err
}
