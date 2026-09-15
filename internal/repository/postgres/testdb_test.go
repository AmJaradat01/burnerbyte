package postgres

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testPool connects to the integration test database. It honours
// TEST_DATABASE_URL and otherwise falls back to the conventional local test DB
// (created via `migrate -database <url> -path migrations up` against
// burnerbyte_test). Tests skip cleanly when no database is reachable.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:password@localhost:5432/burnerbyte_test?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("integration test DB unavailable (%v); set TEST_DATABASE_URL to run", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("integration test DB not reachable (%v); set TEST_DATABASE_URL to run", err)
	}
	requireSchemaAtHead(t, pool)
	t.Cleanup(pool.Close)
	return pool
}

// requireSchemaAtHead fails fast when the test database is behind migrations/.
// A stale database does not skip — it is reachable, so tests run and then fail
// deep inside a query as `column "x" does not exist`, which reads like a code
// bug rather than an out-of-date database. Naming the two versions and the fix
// turns that into a one-line diagnosis.
func requireSchemaAtHead(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()

	head, err := headMigrationVersion()
	if err != nil {
		t.Fatalf("read migrations dir: %v", err)
	}

	var version int
	var dirty bool
	err = pool.QueryRow(context.Background(),
		`SELECT version, dirty FROM schema_migrations`).Scan(&version, &dirty)
	if err != nil {
		t.Fatalf("test database has no schema_migrations table (%v); apply the schema with:\n"+
			"  migrate -database \"$TEST_DATABASE_URL\" -path migrations up", err)
	}
	if dirty {
		t.Fatalf("test database schema is dirty at version %d; resolve with:\n"+
			"  migrate -database \"$TEST_DATABASE_URL\" -path migrations force %d", version, version)
	}
	if version < head {
		t.Fatalf("test database schema is at migration %d but migrations/ is at %d; bring it up to date with:\n"+
			"  make migrate-test-db", version, head)
	}
}

// headMigrationVersion returns the numeric prefix of the highest .up.sql file.
func headMigrationVersion() (int, error) {
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "migrations", "*.up.sql"))
	if err != nil {
		return 0, err
	}
	head := 0
	for _, f := range files {
		name := filepath.Base(f)
		n, err := strconv.Atoi(name[:strings.IndexByte(name, '_')])
		if err != nil {
			continue
		}
		if n > head {
			head = n
		}
	}
	return head, nil
}

// seedOrg inserts a fresh organization and returns its id. Each test uses a
// unique org so cases are isolated without truncating shared tables.
func seedOrg(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	short := id.String()[:8]
	_, err := pool.Exec(context.Background(),
		`INSERT INTO organizations (id, name, slug, settings) VALUES ($1, $2, $3, '{}'::jsonb)`,
		id, "Test Org "+short, "test-"+short)
	if err != nil {
		t.Fatalf("seed org: %v", err)
	}
	return id
}
