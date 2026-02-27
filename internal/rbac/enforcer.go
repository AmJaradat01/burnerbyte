package rbac

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

type Enforcer struct {
	orgRepo  *postgres.OrgRepo
	teamRepo *postgres.TeamRepo
}

func NewEnforcer(orgRepo *postgres.OrgRepo, teamRepo *postgres.TeamRepo) *Enforcer {
	return &Enforcer{orgRepo: orgRepo, teamRepo: teamRepo}
}

// EnforceOrg checks if the user has the required org-level permission.
func (e *Enforcer) EnforceOrg(ctx context.Context, userID, orgID uuid.UUID, resource Resource, action Action) error {
	m, err := e.orgRepo.GetMembership(ctx, userID, orgID)
	if err != nil {
		return fmt.Errorf("forbidden: not a member of this organization")
	}

	if !OrgRoleHasPermission(m.Role, resource, action) {
		return fmt.Errorf("forbidden: insufficient org permissions")
	}

	return nil
}

// EnforceTeam checks if the user has the required team-level permission.
// It first checks org-level (org owners/admins have broad access), then team-level.
func (e *Enforcer) EnforceTeam(ctx context.Context, userID, orgID, teamID uuid.UUID, resource Resource, action Action) error {
	// Check org-level first — org owners/admins may have the permission
	orgM, err := e.orgRepo.GetMembership(ctx, userID, orgID)
	if err == nil && OrgRoleHasPermission(orgM.Role, resource, action) {
		return nil
	}

	// Check team-level
	teamM, err := e.teamRepo.GetMembership(ctx, userID, teamID)
	if err != nil {
		return fmt.Errorf("forbidden: not a member of this team")
	}

	if !TeamRoleHasPermission(teamM.Role, resource, action) {
		return fmt.Errorf("forbidden: insufficient team permissions")
	}

	return nil
}
