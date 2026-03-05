package postgres

import (
	"context"
	"encoding/json"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
)

type SystemConfigRepo struct {
	db database.DBTX
}

func NewSystemConfigRepo(db database.DBTX) *SystemConfigRepo {
	return &SystemConfigRepo{db: db}
}

func (r *SystemConfigRepo) WithTx(tx database.DBTX) *SystemConfigRepo {
	return &SystemConfigRepo{db: tx}
}

func (r *SystemConfigRepo) Get(ctx context.Context, key string, dest any) error {
	var raw []byte
	err := r.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key = $1`, key).Scan(&raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, dest)
}

func (r *SystemConfigRepo) Set(ctx context.Context, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(ctx,
		`INSERT INTO system_configs (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
		key, string(raw))
	return err
}
