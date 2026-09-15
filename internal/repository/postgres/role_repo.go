package postgres

import (
	"context"

	"github.com/google/uuid"
	"gitlab.com/amjaradat01/burnerbyte/internal/database"
)

type Role struct {
	ID          uuid.UUID `json:"id"`
	Scope       string    `json:"scope"`
	Value       string    `json:"value"`
	Label       string    `json:"label"`
	Description string    `json:"description"`
	Rank        int       `json:"rank"`
	IsSystem    bool      `json:"is_system"`
	Permissions []string  `json:"permissions"`
}

type Permission struct {
	ID          uuid.UUID `json:"id"`
	Scope       string    `json:"scope"`
	Key         string    `json:"key"`
	Label       string    `json:"label"`
	Description string    `json:"description"`
}

type RoleRepo struct {
	db database.DBTX
}

func NewRoleRepo(db database.DBTX) *RoleRepo {
	return &RoleRepo{db: db}
}

func (r *RoleRepo) ListRoles(ctx context.Context, scope string) ([]Role, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, scope, value, label, description, rank, is_system FROM roles WHERE scope = $1 ORDER BY rank DESC`, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var roles []Role
	for rows.Next() {
		var role Role
		if err := rows.Scan(&role.ID, &role.Scope, &role.Value, &role.Label, &role.Description, &role.Rank, &role.IsSystem); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	// Load permissions for each role
	for i := range roles {
		perms, err := r.GetRolePermissions(ctx, roles[i].ID)
		if err != nil {
			return nil, err
		}
		roles[i].Permissions = perms
	}
	return roles, nil
}

func (r *RoleRepo) GetRolePermissions(ctx context.Context, roleID uuid.UUID) ([]string, error) {
	rows, err := r.db.Query(ctx,
		`SELECT p.key FROM role_permissions rp JOIN permissions p ON rp.permission_id = p.id WHERE rp.role_id = $1`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var perms []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		perms = append(perms, key)
	}
	return perms, nil
}

func (r *RoleRepo) ListPermissions(ctx context.Context, scope string) ([]Permission, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, scope, key, label, description FROM permissions WHERE scope = $1 ORDER BY key`, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var perms []Permission
	for rows.Next() {
		var p Permission
		if err := rows.Scan(&p.ID, &p.Scope, &p.Key, &p.Label, &p.Description); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, nil
}

func (r *RoleRepo) UpdateRole(ctx context.Context, id uuid.UUID, label, description string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE roles SET label = $1, description = $2 WHERE id = $3`, label, description, id)
	return err
}

func (r *RoleRepo) GetRole(ctx context.Context, id uuid.UUID) (*Role, error) {
	var role Role
	err := r.db.QueryRow(ctx,
		`SELECT id, scope, value, label, description, rank, is_system FROM roles WHERE id = $1`, id).
		Scan(&role.ID, &role.Scope, &role.Value, &role.Label, &role.Description, &role.Rank, &role.IsSystem)
	if err != nil {
		return nil, err
	}
	perms, err := r.GetRolePermissions(ctx, role.ID)
	if err != nil {
		return nil, err
	}
	role.Permissions = perms
	return &role, nil
}

func (r *RoleRepo) SetRolePermissions(ctx context.Context, roleID uuid.UUID, permissionKeys []string) error {
	// Delete existing
	if _, err := r.db.Exec(ctx, `DELETE FROM role_permissions WHERE role_id = $1`, roleID); err != nil {
		return err
	}
	// Insert new
	for _, key := range permissionKeys {
		_, err := r.db.Exec(ctx,
			`INSERT INTO role_permissions (role_id, permission_id)
			 SELECT $1, id FROM permissions WHERE key = $2`, roleID, key)
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *RoleRepo) CreateRole(ctx context.Context, role *Role) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO roles (id, scope, value, label, description, rank, is_system) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		role.ID, role.Scope, role.Value, role.Label, role.Description, role.Rank, role.IsSystem)
	return err
}

func (r *RoleRepo) DeleteRole(ctx context.Context, id uuid.UUID) error {
	// Only allow deleting non-system roles
	_, err := r.db.Exec(ctx, `DELETE FROM roles WHERE id = $1 AND is_system = FALSE`, id)
	return err
}
