package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	appcrypto "gitlab.com/amjaradat01/burnerbyte/internal/crypto"
	"gitlab.com/amjaradat01/burnerbyte/internal/database"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

type SSOProviderRepo struct {
	db        database.DBTX
	encryptor *appcrypto.Encryptor
}

func NewSSOProviderRepo(db database.DBTX, enc *appcrypto.Encryptor) *SSOProviderRepo {
	return &SSOProviderRepo{db: db, encryptor: enc}
}

func (r *SSOProviderRepo) WithTx(tx database.DBTX) *SSOProviderRepo {
	return &SSOProviderRepo{db: tx, encryptor: r.encryptor}
}

func (r *SSOProviderRepo) encryptSecret(secret string) (string, error) {
	if r.encryptor == nil {
		return secret, nil
	}
	return r.encryptor.Encrypt(secret)
}

func (r *SSOProviderRepo) decryptSecret(encrypted string) (string, error) {
	if r.encryptor == nil {
		return encrypted, nil
	}
	return r.encryptor.Decrypt(encrypted)
}

func (r *SSOProviderRepo) Create(ctx context.Context, p *domain.SSOProvider) error {
	encrypted, err := r.encryptSecret(p.ClientSecret)
	if err != nil {
		return fmt.Errorf("encrypt client secret: %w", err)
	}

	claimMappings, _ := json.Marshal(p.ClaimMappings)
	if p.ClaimMappings == nil {
		claimMappings = []byte("[]")
	}
	customClaims, _ := json.Marshal(p.CustomClaims)
	if p.CustomClaims == nil {
		customClaims = []byte("[]")
	}

	_, err = r.db.Exec(ctx,
		`INSERT INTO sso_providers (id, name, provider_type, client_id, client_secret_encrypted, redirect_url,
		 issuer_url, tenant_id, auto_provision, default_org_role, default_team_role, allowed_domains,
		 claim_mappings, custom_claims, enabled, default_team_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		p.ID, p.Name, p.ProviderType, p.ClientID, encrypted, p.RedirectURL,
		p.IssuerURL, p.TenantID, p.AutoProvision, p.DefaultOrgRole, p.DefaultTeamRole, p.AllowedDomains,
		claimMappings, customClaims, p.Enabled, p.DefaultTeamID,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create sso provider: %w", err)
	}
	return nil
}

func (r *SSOProviderRepo) GetByName(ctx context.Context, name string) (*domain.SSOProvider, error) {
	return r.scanOne(ctx,
		`SELECT id, name, provider_type, client_id, client_secret_encrypted, redirect_url,
		 issuer_url, tenant_id, auto_provision, default_org_role, default_team_role, allowed_domains,
		 claim_mappings, custom_claims, enabled, created_at, updated_at, default_team_id
		 FROM sso_providers WHERE name = $1`, name)
}

func (r *SSOProviderRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.SSOProvider, error) {
	return r.scanOne(ctx,
		`SELECT id, name, provider_type, client_id, client_secret_encrypted, redirect_url,
		 issuer_url, tenant_id, auto_provision, default_org_role, default_team_role, allowed_domains,
		 claim_mappings, custom_claims, enabled, created_at, updated_at, default_team_id
		 FROM sso_providers WHERE id = $1`, id)
}

func (r *SSOProviderRepo) List(ctx context.Context) ([]domain.SSOProvider, error) {
	rows, err := r.db.Query(ctx,
		`SELECT p.id, p.name, p.provider_type, p.client_id, p.client_secret_encrypted, p.redirect_url,
		 p.issuer_url, p.tenant_id, p.auto_provision, p.default_org_role, p.default_team_role, p.allowed_domains,
		 p.claim_mappings, p.custom_claims, p.enabled, p.created_at, p.updated_at, p.default_team_id,
		 (SELECT COUNT(*) FROM user_sso_identities usi WHERE usi.provider = p.name) AS linked_user_count
		 FROM sso_providers p ORDER BY p.name`)
	if err != nil {
		return nil, fmt.Errorf("list sso providers: %w", err)
	}
	defer rows.Close()

	var providers []domain.SSOProvider
	for rows.Next() {
		p, err := r.scanRowWithCount(rows)
		if err != nil {
			return nil, err
		}
		providers = append(providers, *p)
	}
	return providers, rows.Err()
}

func (r *SSOProviderRepo) ListEnabled(ctx context.Context) ([]domain.SSOProvider, error) {
	rows, err := r.db.Query(ctx,
		`SELECT p.id, p.name, p.provider_type, p.client_id, p.client_secret_encrypted, p.redirect_url,
		 p.issuer_url, p.tenant_id, p.auto_provision, p.default_org_role, p.default_team_role, p.allowed_domains,
		 p.claim_mappings, p.custom_claims, p.enabled, p.created_at, p.updated_at, p.default_team_id,
		 (SELECT COUNT(*) FROM user_sso_identities usi WHERE usi.provider = p.name) AS linked_user_count
		 FROM sso_providers p WHERE p.enabled = TRUE ORDER BY p.name`)
	if err != nil {
		return nil, fmt.Errorf("list enabled sso providers: %w", err)
	}
	defer rows.Close()

	var providers []domain.SSOProvider
	for rows.Next() {
		p, err := r.scanRowWithCount(rows)
		if err != nil {
			return nil, err
		}
		providers = append(providers, *p)
	}
	return providers, rows.Err()
}

func (r *SSOProviderRepo) Update(ctx context.Context, p *domain.SSOProvider) error {
	// If client_secret is masked, keep existing encrypted value
	encrypted := p.ClientSecretEncrypted
	if p.ClientSecret != "" && p.ClientSecret != "••••••••" {
		var err error
		encrypted, err = r.encryptSecret(p.ClientSecret)
		if err != nil {
			return fmt.Errorf("encrypt client secret: %w", err)
		}
	}

	claimMappings, _ := json.Marshal(p.ClaimMappings)
	if p.ClaimMappings == nil {
		claimMappings = []byte("[]")
	}
	customClaims, _ := json.Marshal(p.CustomClaims)
	if p.CustomClaims == nil {
		customClaims = []byte("[]")
	}

	_, err := r.db.Exec(ctx,
		`UPDATE sso_providers SET name=$1, provider_type=$2, client_id=$3, client_secret_encrypted=$4,
		 redirect_url=$5, issuer_url=$6, tenant_id=$7, auto_provision=$8, default_org_role=$9,
		 default_team_role=$10, allowed_domains=$11, claim_mappings=$12, custom_claims=$13, enabled=$14,
		 default_team_id=$15, updated_at=NOW()
		 WHERE id=$16`,
		p.Name, p.ProviderType, p.ClientID, encrypted,
		p.RedirectURL, p.IssuerURL, p.TenantID, p.AutoProvision, p.DefaultOrgRole,
		p.DefaultTeamRole, p.AllowedDomains, claimMappings, customClaims, p.Enabled,
		p.DefaultTeamID, p.ID,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("update sso provider: %w", err)
	}
	return nil
}

func (r *SSOProviderRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM sso_providers WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete sso provider: %w", err)
	}
	return nil
}

func (r *SSOProviderRepo) CountLinkedUsers(ctx context.Context, providerName string) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM user_sso_identities WHERE provider = $1`, providerName).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count linked users: %w", err)
	}
	return count, nil
}

func (r *SSOProviderRepo) scanOne(ctx context.Context, query string, args ...any) (*domain.SSOProvider, error) {
	var p domain.SSOProvider
	var claimMappings, customClaims []byte
	var issuerURL, tenantID, allowedDomains *string
	var defaultOrgRole, defaultTeamRole *string

	err := r.db.QueryRow(ctx, query, args...).Scan(
		&p.ID, &p.Name, &p.ProviderType, &p.ClientID, &p.ClientSecretEncrypted, &p.RedirectURL,
		&issuerURL, &tenantID, &p.AutoProvision, &defaultOrgRole, &defaultTeamRole, &allowedDomains,
		&claimMappings, &customClaims, &p.Enabled, &p.CreatedAt, &p.UpdatedAt, &p.DefaultTeamID,
	)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan sso provider: %w", err)
	}

	if issuerURL != nil {
		p.IssuerURL = *issuerURL
	}
	if tenantID != nil {
		p.TenantID = *tenantID
	}
	if allowedDomains != nil {
		p.AllowedDomains = *allowedDomains
	}
	if defaultOrgRole != nil {
		p.DefaultOrgRole = *defaultOrgRole
	}
	if defaultTeamRole != nil {
		p.DefaultTeamRole = *defaultTeamRole
	}

	_ = json.Unmarshal(claimMappings, &p.ClaimMappings)
	_ = json.Unmarshal(customClaims, &p.CustomClaims)

	// Decrypt client secret
	if p.ClientSecretEncrypted != "" {
		decrypted, err := r.decryptSecret(p.ClientSecretEncrypted)
		if err != nil {
			// If decryption fails, leave ClientSecret empty
			p.ClientSecret = ""
		} else {
			p.ClientSecret = decrypted
		}
	}

	return &p, nil
}

func (r *SSOProviderRepo) scanRowWithCount(rows interface {
	Scan(dest ...any) error
}) (*domain.SSOProvider, error) {
	var p domain.SSOProvider
	var claimMappings, customClaims []byte
	var issuerURL, tenantID, allowedDomains *string
	var defaultOrgRole, defaultTeamRole *string

	err := rows.Scan(
		&p.ID, &p.Name, &p.ProviderType, &p.ClientID, &p.ClientSecretEncrypted, &p.RedirectURL,
		&issuerURL, &tenantID, &p.AutoProvision, &defaultOrgRole, &defaultTeamRole, &allowedDomains,
		&claimMappings, &customClaims, &p.Enabled, &p.CreatedAt, &p.UpdatedAt, &p.DefaultTeamID,
		&p.LinkedUserCount,
	)
	if err != nil {
		return nil, fmt.Errorf("scan sso provider row: %w", err)
	}

	if issuerURL != nil {
		p.IssuerURL = *issuerURL
	}
	if tenantID != nil {
		p.TenantID = *tenantID
	}
	if allowedDomains != nil {
		p.AllowedDomains = *allowedDomains
	}
	if defaultOrgRole != nil {
		p.DefaultOrgRole = *defaultOrgRole
	}
	if defaultTeamRole != nil {
		p.DefaultTeamRole = *defaultTeamRole
	}

	_ = json.Unmarshal(claimMappings, &p.ClaimMappings)
	_ = json.Unmarshal(customClaims, &p.CustomClaims)

	// Decrypt client secret
	if p.ClientSecretEncrypted != "" {
		decrypted, err := r.decryptSecret(p.ClientSecretEncrypted)
		if err != nil {
			p.ClientSecret = ""
		} else {
			p.ClientSecret = decrypted
		}
	}

	return &p, nil
}
