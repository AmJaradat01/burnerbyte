package config

import (
	"bufio"
	"os"
	"regexp"
	"strings"
	"testing"
)

// config.example.yaml is the documented file form of every setting. It drifts
// silently: a key added to Load() with no matching line here leaves operators
// with no idea the setting exists, and a key here that Load() never registers
// is a documented setting that does nothing. Both have happened.
const (
	exampleConfig = "../../config.example.yaml"
	exampleEnv    = "../../.env.example"
)

func TestConfigExampleParses(t *testing.T) {
	t.Setenv("BB_CONFIG_PATH", exampleConfig)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("config.example.yaml failed to load: %v", err)
	}

	// Spot-check one value per shape (string, int, duration) so a key that
	// parses but does not bind to its struct field is still caught.
	if cfg.SMTP.Hostname != "mail.example.com" {
		t.Errorf("smtp.hostname = %q, want mail.example.com", cfg.SMTP.Hostname)
	}
	if cfg.Password.BcryptCost != 10 {
		t.Errorf("password_policy.bcrypt_cost = %d, want 10", cfg.Password.BcryptCost)
	}
	if cfg.Defaults.WebhookMaxRetries != 3 {
		t.Errorf("defaults.webhook_max_retries = %d, want 3", cfg.Defaults.WebhookMaxRetries)
	}
	if cfg.EmailVerification.TTL <= 0 {
		t.Errorf("email_verification.ttl = %v, want > 0", cfg.EmailVerification.TTL)
	}
}

// TestConfigExampleCoversEveryRegisteredKey keeps the example file exhaustive.
func TestConfigExampleCoversEveryRegisteredKey(t *testing.T) {
	registered := registeredKeys(t)
	documented := documentedKeys(t)

	// Deployment secrets are deliberately absent from the committed example.
	secrets := map[string]bool{
		"database.url": true, "redis.url": true,
		"jwt.secret": true, "encryption.key": true,
	}

	for key := range registered {
		if secrets[key] {
			continue
		}
		if !documented[key] {
			t.Errorf("%s is registered in Load() but missing from config.example.yaml", key)
		}
	}
	for key := range documented {
		if !registered[key] {
			t.Errorf("%s is in config.example.yaml but never registered, so setting it does nothing", key)
		}
	}
}

var (
	reRegistered = regexp.MustCompile(`v\.(?:SetDefault|BindEnv)\("([a-z_.]+)"`)
	reSection    = regexp.MustCompile(`^([a-z_]+):`)
	reLeaf       = regexp.MustCompile(`^  ([a-z_]+):`)
)

func registeredKeys(t *testing.T) map[string]bool {
	t.Helper()
	src, err := os.ReadFile("config.go")
	if err != nil {
		t.Fatalf("read config.go: %v", err)
	}
	keys := map[string]bool{}
	for _, m := range reRegistered.FindAllStringSubmatch(string(src), -1) {
		keys[m[1]] = true
	}
	return keys
}

// documentedKeys parses the example's two-level mapping without pulling in a
// YAML dependency; the file is deliberately kept to that shape.
func documentedKeys(t *testing.T) map[string]bool {
	t.Helper()
	f, err := os.Open(exampleConfig)
	if err != nil {
		t.Fatalf("open %s: %v", exampleConfig, err)
	}
	defer f.Close()

	keys := map[string]bool{}
	section := ""
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		if m := reSection.FindStringSubmatch(line); m != nil {
			section = m[1]
			if strings.TrimSpace(strings.SplitN(line, ":", 2)[1]) != "" {
				keys[section] = true
			}
			continue
		}
		if m := reLeaf.FindStringSubmatch(line); m != nil && section != "" {
			keys[section+"."+m[1]] = true
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("scan %s: %v", exampleConfig, err)
	}
	return keys
}

// TestEnvExampleCoversEveryRegisteredKey keeps .env.example exhaustive for the
// same reason as config.example.yaml: an operator reads it to discover what is
// tunable, and a key absent from it is effectively undocumented.
func TestEnvExampleCoversEveryRegisteredKey(t *testing.T) {
	src, err := os.ReadFile("config.go")
	if err != nil {
		t.Fatalf("read config.go: %v", err)
	}
	text := string(src)

	// Keys bound to an explicit unprefixed name (DATABASE_URL, DEMO_TTL, ...);
	// everything else is BB_ + the key path with dots as underscores.
	explicit := map[string]string{}
	for _, m := range regexp.MustCompile(`v\.BindEnv\("([a-z_.]+)", "([A-Z_]+)"\)`).FindAllStringSubmatch(text, -1) {
		explicit[m[1]] = m[2]
	}

	env, err := os.ReadFile(exampleEnv)
	if err != nil {
		t.Fatalf("read %s: %v", exampleEnv, err)
	}
	envText := string(env)

	for key := range registeredKeys(t) {
		name, ok := explicit[key]
		if !ok {
			name = "BB_" + strings.ToUpper(strings.ReplaceAll(key, ".", "_"))
		}
		// A commented-out line still documents the variable.
		if !regexp.MustCompile(`(?m)^#?\s*` + regexp.QuoteMeta(name) + `=`).MatchString(envText) {
			t.Errorf("%s (%s) is registered in Load() but absent from .env.example", name, key)
		}
	}
}

// A deployment that never writes a .env picks up the fallback in
// docker-compose.yml, which is long enough to clear the minimum-length check.
// Booting on it means running a signing key anyone can read in the repository.
func TestPublishedDefaultJWTSecretsAreRejected(t *testing.T) {
	for _, secret := range publishedDefaultJWTSecrets {
		if len(secret) < 32 {
			// Short secrets are already caught by the length check; these are
			// dangerous precisely because they are not.
			continue
		}
		if !IsPublishedDefaultJWTSecret(secret) {
			t.Errorf("published default %q is not recognised", secret)
		}
	}
	if IsPublishedDefaultJWTSecret("a-genuinely-random-operator-chosen-secret-value") {
		t.Error("an operator-chosen secret was rejected as a published default")
	}
}

// The check is only useful while the strings match what the repository
// actually ships, so read them back out of the files.
func TestPublishedDefaultListMatchesTheRepository(t *testing.T) {
	for _, f := range []string{"../../docker-compose.yml", "../../.env.example"} {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		for _, m := range regexp.MustCompile(`JWT_SECRET[:=]\s*\$?\{?[A-Z_]*:?-?([^}\s"']+)\}?`).FindAllStringSubmatch(string(raw), -1) {
			candidate := m[1]
			if len(candidate) < 32 || strings.HasPrefix(candidate, "$") {
				continue
			}
			if !IsPublishedDefaultJWTSecret(candidate) {
				t.Errorf("%s ships JWT secret %q, which IsPublishedDefaultJWTSecret does not recognise; add it to publishedDefaultJWTSecrets", f, candidate)
			}
		}
	}
}
