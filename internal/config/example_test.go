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
