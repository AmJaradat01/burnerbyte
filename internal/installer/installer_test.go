package installer

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	yaml "go.yaml.in/yaml/v3"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

func TestNeeded(t *testing.T) {
	var unset config.Config
	if !Needed(&unset) {
		t.Error("Needed should be true when database URL is empty")
	}
	var blank config.Config
	blank.Database.URL = "   "
	if !Needed(&blank) {
		t.Error("Needed should be true when database URL is only whitespace")
	}
	var set config.Config
	set.Database.URL = "postgres://u:p@h:5432/db"
	if Needed(&set) {
		t.Error("Needed should be false once a database URL is configured")
	}
}

func TestValidate(t *testing.T) {
	valid := installInput{DatabaseURL: "postgres://h/db", RedisURL: "redis://h:6379", JWTSecret: strings.Repeat("a", 32)}
	if msg := validate(valid); msg != "" {
		t.Errorf("valid input rejected: %s", msg)
	}
	withEnc := valid
	withEnc.EncryptionKey = strings.Repeat("ab", 32) // 64 hex chars
	if msg := validate(withEnc); msg != "" {
		t.Errorf("valid input with encryption key rejected: %s", msg)
	}

	cases := map[string]installInput{
		"missing db":    {RedisURL: "redis://h", JWTSecret: strings.Repeat("a", 32)},
		"missing redis": {DatabaseURL: "postgres://h", JWTSecret: strings.Repeat("a", 32)},
		"short jwt":     {DatabaseURL: "postgres://h", RedisURL: "redis://h", JWTSecret: "tooshort"},
		"bad enc len":   {DatabaseURL: "postgres://h", RedisURL: "redis://h", JWTSecret: strings.Repeat("a", 32), EncryptionKey: "abcd"},
		"bad enc hex":   {DatabaseURL: "postgres://h", RedisURL: "redis://h", JWTSecret: strings.Repeat("a", 32), EncryptionKey: strings.Repeat("zz", 32)},
	}
	for name, in := range cases {
		if msg := validate(in); msg == "" {
			t.Errorf("%s: expected a validation error", name)
		}
	}
}

func TestWriteConfigRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{}
	cfg.Server.Port = 9091
	in := installInput{
		DatabaseURL:   "postgres://u:p@db:5432/burnerbyte?sslmode=disable",
		RedisURL:      "redis://:secret@redis:6379/0",
		JWTSecret:     strings.Repeat("k", 40),
		EncryptionKey: strings.Repeat("ab", 32),
	}
	if err := writeConfig(path, cfg, in); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("config file mode = %o, want 600 (contains secrets)", perm)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var doc map[string]map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("unmarshal written config: %v", err)
	}
	if got := doc["database"]["url"]; got != in.DatabaseURL {
		t.Errorf("database.url = %v, want %q", got, in.DatabaseURL)
	}
	if got := doc["redis"]["url"]; got != in.RedisURL {
		t.Errorf("redis.url = %v, want %q", got, in.RedisURL)
	}
	if got := doc["jwt"]["secret"]; got != in.JWTSecret {
		t.Errorf("jwt.secret round-trip mismatch")
	}
	if got := doc["encryption"]["key"]; got != in.EncryptionKey {
		t.Errorf("encryption.key round-trip mismatch")
	}
	if got, ok := doc["server"]["port"].(int); !ok || got != 9091 {
		t.Errorf("server.port = %v, want 9091", doc["server"]["port"])
	}
}

func TestWriteConfigOmitsBlankEncryption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	in := installInput{DatabaseURL: "postgres://h/db", RedisURL: "redis://h", JWTSecret: strings.Repeat("k", 40)}
	if err := writeConfig(path, &config.Config{}, in); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}
	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), "encryption") {
		t.Error("encryption section should be omitted when no key is provided")
	}
}

func TestGate(t *testing.T) {
	s := &server{token: "secret-token"}
	var reached bool
	h := s.gate(func(w http.ResponseWriter, _ *http.Request) { reached = true; w.WriteHeader(http.StatusOK) })

	// Missing token.
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/install", nil))
	if rec.Code != http.StatusForbidden || reached {
		t.Errorf("missing token: code=%d reached=%v, want 403 and not reached", rec.Code, reached)
	}

	// Wrong token.
	reached = false
	rec = httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/install?token=wrong", nil))
	if rec.Code != http.StatusForbidden || reached {
		t.Errorf("wrong token: code=%d reached=%v, want 403 and not reached", rec.Code, reached)
	}

	// Correct token via query.
	reached = false
	rec = httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/install?token=secret-token", nil))
	if rec.Code != http.StatusOK || !reached {
		t.Errorf("correct token: code=%d reached=%v, want 200 and reached", rec.Code, reached)
	}

	// Correct token via header.
	reached = false
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/install", nil)
	req.Header.Set("X-Install-Token", "secret-token")
	h(rec, req)
	if rec.Code != http.StatusOK || !reached {
		t.Errorf("header token: code=%d reached=%v, want 200 and reached", rec.Code, reached)
	}
}

// TestWriteConfigLoadsBackThroughConfigLoad is the true round-trip: the installer
// writes config.yaml at BB_CONFIG_PATH, and config.Load reads it back into the
// running config (so the re-exec'd process boots configured, and Needed flips to
// false). Ambient secret env vars are cleared so the file is the only source.
func TestWriteConfigLoadsBackThroughConfigLoad(t *testing.T) {
	for _, k := range []string{"DATABASE_URL", "REDIS_URL", "JWT_SECRET", "ENCRYPTION_KEY"} {
		if v, ok := os.LookupEnv(k); ok {
			os.Unsetenv(k)
			defer os.Setenv(k, v)
		}
	}
	path := filepath.Join(t.TempDir(), "config.yaml")
	t.Setenv("BB_CONFIG_PATH", path)

	in := installInput{
		DatabaseURL:   "postgres://u:p@db:5432/burnerbyte?sslmode=disable",
		RedisURL:      "redis://:secret@redis:6379/0",
		JWTSecret:     strings.Repeat("k", 40),
		EncryptionKey: strings.Repeat("ab", 32),
	}
	if err := writeConfig(path, &config.Config{}, in); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	if cfg.Database.URL != in.DatabaseURL {
		t.Errorf("database.url = %q, want %q", cfg.Database.URL, in.DatabaseURL)
	}
	if cfg.Redis.URL != in.RedisURL {
		t.Errorf("redis.url = %q, want %q", cfg.Redis.URL, in.RedisURL)
	}
	if cfg.JWT.Secret != in.JWTSecret {
		t.Error("jwt.secret did not round-trip through config.Load")
	}
	if cfg.Encryption.Key != in.EncryptionKey {
		t.Error("encryption.key did not round-trip through config.Load")
	}
	if Needed(cfg) {
		t.Error("Needed should be false after the installer writes a database URL")
	}
}

// handleComplete must reject invalid input before attempting any connection.
func TestHandleCompleteValidation(t *testing.T) {
	s := &server{cfg: &config.Config{}, done: make(chan struct{})}
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"database_url":"postgres://h/db","redis_url":"redis://h","jwt_secret":"tooshort"}`)
	s.handleComplete(rec, httptest.NewRequest(http.MethodPost, "/install/complete", body))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("short jwt: status = %d, want 400", rec.Code)
	}
	select {
	case <-s.done:
		t.Error("done channel must not be closed on a validation failure")
	default:
	}
}
