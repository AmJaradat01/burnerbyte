package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// The link intent used to travel to the callback inside the sso_state cookie,
// as "state|link|<userID>", and the callback linked whichever account that
// user ID named. The callback is a public route, so there was no session to
// check it against — the authorization decision was held entirely by the
// client.
//
// HttpOnly stops same-origin JavaScript from writing that cookie, but not
// cookie tossing from a sibling subdomain, and not an active attacker on
// plain HTTP. Given either, someone could run their own SSO flow, plant
// "state|link|<victim-id>" in the victim's browser and complete the callback
// there, binding their own identity-provider account to the victim's account.
//
// The intent now lives server-side, keyed by the random state value that
// already round-trips. The client holds an opaque key, never the decision.

// SSOStateData is the server-held meaning of an in-flight SSO state value.
type SSOStateData struct {
	// Intent is "" for a normal login or "link" to attach the returned
	// identity to an existing account.
	Intent string `json:"intent"`
	// UserID is the account to link to. Set only for Intent == "link", and
	// only from the authenticated session that started the flow.
	UserID string `json:"user_id,omitempty"`
	// Origin is the validated frontend origin to redirect back to.
	Origin string `json:"origin,omitempty"`
}

// SSOStateStore holds SSO state metadata for the life of one redirect.
type SSOStateStore struct {
	rdb *redis.Client
	ttl time.Duration
}

func NewSSOStateStore(rdb *redis.Client, ttl time.Duration) *SSOStateStore {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return &SSOStateStore{rdb: rdb, ttl: ttl}
}

func (s *SSOStateStore) key(state string) string { return "sso_state:" + state }

// Store records the intent for a freshly generated state value.
func (s *SSOStateStore) Store(ctx context.Context, state, intent, origin string, userID *uuid.UUID) error {
	d := SSOStateData{Intent: intent, Origin: origin}
	if userID != nil {
		d.UserID = userID.String()
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return fmt.Errorf("marshal sso state: %w", err)
	}
	return s.rdb.Set(ctx, s.key(state), raw, s.ttl).Err()
}

// Consume reads and deletes the metadata for a state value. Deleting on read
// makes the state single-use, so a callback cannot be replayed.
func (s *SSOStateStore) Consume(ctx context.Context, state string) (*SSOStateData, error) {
	val, err := s.rdb.GetDel(ctx, s.key(state)).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrSSOStateInvalid
		}
		return nil, fmt.Errorf("consume sso state: %w", err)
	}
	var d SSOStateData
	if err := json.Unmarshal([]byte(val), &d); err != nil {
		return nil, fmt.Errorf("unmarshal sso state: %w", err)
	}
	return &d, nil
}

var ErrSSOStateInvalid = errors.New("invalid or expired SSO state")
