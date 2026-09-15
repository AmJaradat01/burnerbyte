package smtp

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
	redisrepo "github.com/amjaradat01/burnerbyte/internal/repository/redis"
)

// Router determines if an inbound email should be accepted or rejected.
type Router struct {
	domainRepo     *postgres.DomainRepo
	inboxRepoRedis *redisrepo.InboxRepo
	inboxRepoPG    *postgres.InboxRepo
}

func NewRouter(
	domainRepo *postgres.DomainRepo,
	inboxRepoRedis *redisrepo.InboxRepo,
	inboxRepoPG *postgres.InboxRepo,
) *Router {
	return &Router{
		domainRepo:     domainRepo,
		inboxRepoRedis: inboxRepoRedis,
		inboxRepoPG:    inboxRepoPG,
	}
}

// CanAccept checks if the recipient address maps to a valid, active inbox.
// Returns the inbox ID if accepted, or an error for rejection.
func (r *Router) CanAccept(ctx context.Context, rcptTo string) (string, error) {
	addr := strings.ToLower(strings.TrimSpace(rcptTo))
	parts := strings.SplitN(addr, "@", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid address format")
	}

	// Check domain exists
	_, err := r.domainRepo.GetByName(ctx, parts[1])
	if err != nil {
		return "", fmt.Errorf("unknown domain: %s", parts[1])
	}

	// Check inbox in Redis first
	inboxID, err := r.inboxRepoRedis.Get(ctx, addr)
	if err == nil && inboxID != "" {
		return inboxID, nil
	}

	// Fallback to PG
	inbox, err := r.inboxRepoPG.GetByFullAddress(ctx, addr)
	if err != nil {
		return "", fmt.Errorf("unknown recipient: %s", addr)
	}
	if !inbox.IsActive || time.Now().After(inbox.ExpiresAt) {
		return "", fmt.Errorf("inbox expired: %s", addr)
	}

	return inbox.ID.String(), nil
}
