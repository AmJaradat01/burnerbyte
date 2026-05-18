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

var ErrSSOCodeInvalid = errors.New("invalid or expired SSO code")

type SSOCodeData struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	UserID       string `json:"user_id"`
}

type SSOCodeStore struct {
	rdb *redis.Client
	ttl time.Duration
}

func NewSSOCodeStore(rdb *redis.Client, ttl time.Duration) *SSOCodeStore {
	return &SSOCodeStore{rdb: rdb, ttl: ttl}
}

func (s *SSOCodeStore) Store(ctx context.Context, code string, accessToken, refreshToken string, userID uuid.UUID) error {
	data, err := json.Marshal(SSOCodeData{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		UserID:       userID.String(),
	})
	if err != nil {
		return fmt.Errorf("marshal sso code data: %w", err)
	}
	return s.rdb.Set(ctx, "sso_code:"+code, data, s.ttl).Err()
}

func (s *SSOCodeStore) Exchange(ctx context.Context, code string) (*SSOCodeData, error) {
	key := "sso_code:" + code
	val, err := s.rdb.GetDel(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrSSOCodeInvalid
		}
		return nil, fmt.Errorf("exchange sso code: %w", err)
	}
	var d SSOCodeData
	if err := json.Unmarshal([]byte(val), &d); err != nil {
		return nil, fmt.Errorf("unmarshal sso code data: %w", err)
	}
	return &d, nil
}
