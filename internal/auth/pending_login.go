package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// ErrPendingLoginNotFound is returned when a pending login token does not exist
// or has already been consumed.
var ErrPendingLoginNotFound = errors.New("pending login not found")

// PendingLogin holds the state for a pending session conflict resolution.
type PendingLogin struct {
	UserID    uuid.UUID `json:"user_id"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"user_agent"`
}

// PendingLoginStore is a Redis-backed store for pending login tokens used
// during the two-phase session conflict resolution flow.
type PendingLoginStore struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewPendingLoginStore creates a new PendingLoginStore.
func NewPendingLoginStore(rdb *redis.Client, ttl time.Duration) *PendingLoginStore {
	return &PendingLoginStore{rdb: rdb, ttl: ttl}
}

// Store saves a pending login and returns a cryptographically random token.
// The token is a 64-character hex string derived from 32 random bytes.
func (s *PendingLoginStore) Store(ctx context.Context, pending PendingLogin) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate pending login token: %w", err)
	}
	token := hex.EncodeToString(b)

	data, err := json.Marshal(pending)
	if err != nil {
		return "", fmt.Errorf("marshal pending login: %w", err)
	}

	key := fmt.Sprintf("pending_login:%s", token)
	if err := s.rdb.Set(ctx, key, data, s.ttl).Err(); err != nil {
		return "", fmt.Errorf("store pending login: %w", err)
	}

	return token, nil
}

// Peek retrieves a pending login by token without consuming it.
// Used by the SSO conflict flow to fetch session list for display.
// Returns ErrPendingLoginNotFound if the token is invalid or expired.
func (s *PendingLoginStore) Peek(ctx context.Context, token string) (*PendingLogin, error) {
	key := fmt.Sprintf("pending_login:%s", token)

	val, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrPendingLoginNotFound
		}
		return nil, fmt.Errorf("peek pending login: %w", err)
	}

	var pending PendingLogin
	if err := json.Unmarshal([]byte(val), &pending); err != nil {
		return nil, fmt.Errorf("unmarshal pending login: %w", err)
	}

	return &pending, nil
}

// Consume retrieves and deletes a pending login by token (single-use).
// Returns ErrPendingLoginNotFound if the token is invalid, expired, or already consumed.
func (s *PendingLoginStore) Consume(ctx context.Context, token string) (*PendingLogin, error) {
	key := fmt.Sprintf("pending_login:%s", token)

	val, err := s.rdb.GetDel(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrPendingLoginNotFound
		}
		return nil, fmt.Errorf("consume pending login: %w", err)
	}

	var pending PendingLogin
	if err := json.Unmarshal([]byte(val), &pending); err != nil {
		return nil, fmt.Errorf("unmarshal pending login: %w", err)
	}

	return &pending, nil
}
