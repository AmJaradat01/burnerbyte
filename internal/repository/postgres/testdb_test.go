package postgres

import (
	"context"
	"os"
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
	t.Cleanup(pool.Close)
	return pool
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
