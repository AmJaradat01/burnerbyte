// Package installer provides the first-run web installer: a token-gated,
// self-contained bootstrap server that runs only when no database has been
// configured yet. It collects the bootstrap settings the app needs before it
// can connect to anything (database URL, Redis URL, JWT secret, encryption key),
// verifies them, writes a config.yaml, and re-execs into normal boot.
//
// It exists because the database and Redis are hard bootstrap dependencies: the
// app (and its own state) cannot run without them, so they cannot be configured
// from the in-app setup wizard. Everything else (storage, SMTP, SSO, platform
// settings) is configured later, from inside the running app.
package installer

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"encoding/json"

	yaml "go.yaml.in/yaml/v3"

	"github.com/amjaradat01/burnerbyte/internal/config"
	"github.com/amjaradat01/burnerbyte/internal/database"
)

// Needed reports whether the first-run installer should run: no database URL has
// been configured (via env or a config file). An already-configured instance
// therefore never exposes the installer.
func Needed(cfg *config.Config) bool {
	return strings.TrimSpace(cfg.Database.URL) == ""
}

// configPath is where the installer writes the generated config. Defaults to
// ./config.yaml (read by viper's "." search path); override with BB_CONFIG_PATH.
func configPath() string {
	if p := strings.TrimSpace(os.Getenv("BB_CONFIG_PATH")); p != "" {
		return p
	}
	return "config.yaml"
}

type server struct {
	cfg   *config.Config
	token string
	srv   *http.Server
	done  chan struct{}
}

// Run starts the installer and blocks until the operator completes setup, after
// which it re-execs the process into normal boot (or, if re-exec fails, exits 0
// so an orchestrator with a restart policy starts a fresh, now-configured boot).
func Run(cfg *config.Config) error {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return fmt.Errorf("generate installer token: %w", err)
	}
	s := &server{cfg: cfg, token: hex.EncodeToString(tokenBytes), done: make(chan struct{})}

	port := cfg.Server.Port
	if port == 0 {
		port = 8080
	}
	addr := fmt.Sprintf(":%d", port)

	mux := http.NewServeMux()
	mux.HandleFunc("/install", s.gate(s.handlePage))
	mux.HandleFunc("/install/test", s.gate(s.handleTest))
	mux.HandleFunc("/install/complete", s.gate(s.handleComplete))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	// Anything else points the operator at the install URL.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "BurnerByte is not configured yet. Open /install?token=... (see server logs for the token).", http.StatusServiceUnavailable)
	})

	s.srv = &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}

	slog.Warn("no database configured — starting first-run web installer",
		"url", fmt.Sprintf("http://<host>:%d/install?token=%s", port, s.token),
		"token", s.token,
		"hint", "open the URL above to configure the database, Redis, and secrets")

	go func() {
		if err := s.srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("installer server error", "error", err)
			close(s.done)
		}
	}()

	<-s.done // closed by handleComplete (after a successful write) or on server error
	// Give the success response time to flush before the process is replaced.
	time.Sleep(750 * time.Millisecond)
	_ = s.srv.Close()
	reexec()
	return nil
}

// gate enforces the one-time token (constant-time) on every installer endpoint.
func (s *server) gate(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := r.URL.Query().Get("token")
		if tok == "" {
			tok = r.Header.Get("X-Install-Token")
		}
		if subtle.ConstantTimeCompare([]byte(tok), []byte(s.token)) != 1 {
			http.Error(w, "invalid or missing installer token", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

func (s *server) handlePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
	_, _ = w.Write([]byte(installPage))
}

type installInput struct {
	DatabaseURL   string `json:"database_url"`
	RedisURL      string `json:"redis_url"`
	JWTSecret     string `json:"jwt_secret"`
	EncryptionKey string `json:"encryption_key"`
}

func (s *server) handleTest(w http.ResponseWriter, r *http.Request) {
	var in installInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "invalid request body"})
		return
	}
	if msg := testConnections(r.Context(), in.DatabaseURL, in.RedisURL); msg != "" {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "message": msg})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Database and Redis are reachable."})
}

func (s *server) handleComplete(w http.ResponseWriter, r *http.Request) {
	var in installInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "invalid request body"})
		return
	}
	in.DatabaseURL = strings.TrimSpace(in.DatabaseURL)
	in.RedisURL = strings.TrimSpace(in.RedisURL)
	in.JWTSecret = strings.TrimSpace(in.JWTSecret)
	in.EncryptionKey = strings.TrimSpace(in.EncryptionKey)

	if err := validate(in); err != "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": err})
		return
	}
	if msg := testConnections(r.Context(), in.DatabaseURL, in.RedisURL); msg != "" {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "message": msg})
		return
	}
	path := configPath()
	if err := writeConfig(path, s.cfg, in); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "failed to write config: " + err.Error()})
		return
	}
	slog.Info("installer wrote configuration; restarting into normal boot", "path", path)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Configuration saved. The server is restarting."})
	// Trigger the restart once this response has been sent.
	select {
	case <-s.done:
	default:
		close(s.done)
	}
}

// validate returns a human-readable error message, or "" when input is valid.
func validate(in installInput) string {
	if in.DatabaseURL == "" {
		return "database URL is required"
	}
	if in.RedisURL == "" {
		return "Redis URL is required"
	}
	if len(in.JWTSecret) < 32 {
		return "JWT secret must be at least 32 characters"
	}
	if in.EncryptionKey != "" {
		if _, err := hex.DecodeString(in.EncryptionKey); err != nil || len(in.EncryptionKey) != 64 {
			return "encryption key must be a 64-character hex string (32 bytes), or left blank"
		}
	}
	return ""
}

// testConnections returns "" on success or a human-readable failure message.
func testConnections(ctx context.Context, dbURL, redisURL string) string {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	if strings.TrimSpace(dbURL) == "" {
		return "database URL is required"
	}
	pool, err := database.NewPostgres(ctx, config.DatabaseConfig{
		URL: dbURL, MaxOpenConns: 2, MaxIdleConns: 1, ConnMaxLifetime: time.Minute,
	})
	if err != nil {
		return "database connection failed: " + err.Error()
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return "database ping failed: " + err.Error()
	}

	if strings.TrimSpace(redisURL) == "" {
		return "Redis URL is required"
	}
	rdb, err := database.NewRedis(ctx, config.RedisConfig{URL: redisURL})
	if err != nil {
		return "Redis connection failed: " + err.Error()
	}
	defer rdb.Close() //nolint:errcheck
	if err := rdb.Ping(ctx).Err(); err != nil {
		return "Redis ping failed: " + err.Error()
	}
	return ""
}

// writeConfig marshals the collected bootstrap settings to a config.yaml that
// viper reads on the next boot. Written 0600 because it contains secrets.
func writeConfig(path string, cfg *config.Config, in installInput) error {
	port := cfg.Server.Port
	if port == 0 {
		port = 8080
	}
	doc := map[string]any{
		"server":   map[string]any{"port": port},
		"database": map[string]any{"url": in.DatabaseURL},
		"redis":    map[string]any{"url": in.RedisURL},
		"jwt":      map[string]any{"secret": in.JWTSecret},
	}
	if in.EncryptionKey != "" {
		doc["encryption"] = map[string]any{"key": in.EncryptionKey}
	}
	out, err := yaml.Marshal(doc)
	if err != nil {
		return err
	}
	header := "# Generated by the BurnerByte first-run installer. Contains secrets.\n"
	return os.WriteFile(path, append([]byte(header), out...), 0o600)
}

// reexec replaces the current process so it boots again, now that config.yaml
// exists. Falls back to a clean exit (orchestrators with a restart policy then
// start a fresh, configured process).
func reexec() {
	exe, err := os.Executable()
	if err != nil {
		slog.Error("installer: cannot find executable for restart; exiting for supervisor restart", "error", err)
		os.Exit(0)
	}
	if _, statErr := exec.LookPath(exe); statErr == nil {
		slog.Info("installer: restarting", "exe", exe)
		err = syscall.Exec(exe, os.Args, os.Environ())
	}
	slog.Warn("installer: re-exec unavailable, exiting for supervisor restart", "error", err)
	os.Exit(0)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
