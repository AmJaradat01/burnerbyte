package postgres

import (
	"context"
	"encoding/json"

	"gitlab.com/burnerbyte/burnerbyte/internal/crypto"
	"gitlab.com/burnerbyte/burnerbyte/internal/database"
)

// sensitiveKeys are system_config keys that contain credentials and should be encrypted.
var sensitiveKeys = map[string]bool{
	"sso":    true,
	"mailer": true,
}

type SystemConfigRepo struct {
	db        database.DBTX
	encryptor *crypto.Encryptor // nil = encryption disabled (plaintext)
}

func NewSystemConfigRepo(db database.DBTX) *SystemConfigRepo {
	return &SystemConfigRepo{db: db}
}

func (r *SystemConfigRepo) WithEncryptor(enc *crypto.Encryptor) *SystemConfigRepo {
	r.encryptor = enc
	return r
}

func (r *SystemConfigRepo) WithTx(tx database.DBTX) *SystemConfigRepo {
	return &SystemConfigRepo{db: tx, encryptor: r.encryptor}
}

func (r *SystemConfigRepo) Get(ctx context.Context, key string, dest any) error {
	var raw []byte
	err := r.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key = $1`, key).Scan(&raw)
	if err != nil {
		return err
	}

	// Decrypt if this is a sensitive key and encryption is enabled
	if sensitiveKeys[key] && r.encryptor != nil {
		// Try to decrypt — if it fails, assume it's still plaintext (pre-encryption migration)
		var encWrapper struct {
			Encrypted string `json:"_encrypted"`
		}
		if json.Unmarshal(raw, &encWrapper) == nil && encWrapper.Encrypted != "" {
			plaintext, err := r.encryptor.Decrypt(encWrapper.Encrypted)
			if err != nil {
				return err
			}
			raw = []byte(plaintext)
		}
	}

	return json.Unmarshal(raw, dest)
}

func (r *SystemConfigRepo) Set(ctx context.Context, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}

	storeValue := string(raw)

	// Encrypt sensitive keys
	if sensitiveKeys[key] && r.encryptor != nil {
		encrypted, err := r.encryptor.Encrypt(string(raw))
		if err != nil {
			return err
		}
		wrapper, _ := json.Marshal(map[string]string{"_encrypted": encrypted})
		storeValue = string(wrapper)
	}

	_, err = r.db.Exec(ctx,
		`INSERT INTO system_configs (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
		key, storeValue)
	return err
}
