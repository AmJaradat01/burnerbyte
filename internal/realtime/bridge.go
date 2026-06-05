package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	ChannelInbox = "bb:inbox"
	ChannelNotif = "bb:notif"
)

type InboxEvent struct {
	InboxID      uuid.UUID `json:"inbox_id"`
	UserID       uuid.UUID `json:"user_id"`
	OrgID        uuid.UUID `json:"org_id"`
	SizeBytes    int64     `json:"size_bytes"`
	SenderDomain string    `json:"sender_domain"`
	DomainName   string    `json:"domain_name"`
	TeamID       uuid.UUID `json:"team_id"`
	Hour         int       `json:"hour"`
	Message      Message   `json:"message"`
}

// Publisher — used by smtpd to publish events to Redis.
type Publisher struct {
	rdb *redis.Client
}

func NewPublisher(rdb *redis.Client) *Publisher {
	return &Publisher{rdb: rdb}
}

func (p *Publisher) PublishInboxEvent(ctx context.Context, inboxID, userID, orgID uuid.UUID, sizeBytes int64, senderDomain, domainName string, teamID uuid.UUID, hour int, msg Message) {
	evt := InboxEvent{
		InboxID: inboxID, UserID: userID, OrgID: orgID, SizeBytes: sizeBytes,
		SenderDomain: senderDomain, DomainName: domainName, TeamID: teamID, Hour: hour,
		Message: msg,
	}
	data, err := json.Marshal(evt)
	if err != nil {
		return
	}
	if err := p.rdb.Publish(ctx, ChannelInbox, data).Err(); err != nil {
		slog.Error("redis: failed to publish inbox event", "error", err)
	}
}

// NotificationPersister is the interface the bridge needs to persist notifications.
type NotificationPersister interface {
	Create(ctx context.Context, userID uuid.UUID, typ, title, message string, inboxID *uuid.UUID) error
}

// CounterPersister is the interface the bridge needs to increment analytics counters.
type CounterPersister interface {
	IncrementEmail(ctx context.Context, orgID uuid.UUID, sizeBytes int64) error
	UpsertDailyStat(ctx context.Context, orgID uuid.UUID, emailsReceived, inboxesCreated int, storageBytes int64) error
	UpsertHourlyStat(ctx context.Context, orgID uuid.UUID, hour int) error
	UpsertDomainStat(ctx context.Context, orgID uuid.UUID, domainName string) error
	UpsertSenderDomainStat(ctx context.Context, orgID uuid.UUID, senderDomain string) error
	UpsertDailyTeamStat(ctx context.Context, teamID uuid.UUID, emailsReceived, inboxesCreated int, storageBytes int64) error
	IncrementTeamEmail(ctx context.Context, teamID uuid.UUID, sizeBytes int64) error
}

// Subscribe — used by API server to receive events and forward to hubs.
func Subscribe(ctx context.Context, rdb *redis.Client, hub *Hub, notifHub *NotifHub, notifRepo NotificationPersister, counterRepo CounterPersister) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			sub := rdb.Subscribe(ctx, ChannelInbox)
			ch := sub.Channel()
			for msg := range ch {
				var evt InboxEvent
				if err := json.Unmarshal([]byte(msg.Payload), &evt); err != nil {
					slog.Error("redis: failed to unmarshal inbox event", "error", err)
					continue
				}
				if hub != nil {
					hub.Broadcast(evt.InboxID, evt.Message)
				}
				if notifHub != nil {
					notifHub.Notify(evt.UserID, evt.Message)
				}
				if notifRepo != nil {
					var title, body string
					m, _ := evt.Message.Data.(map[string]interface{})
					switch evt.Message.Type {
					case "email.received":
						title = "New email received"
						from, _ := m["from_address"].(string)
						subj, _ := m["subject"].(string)
						if subj == "" {
							subj = "(no subject)"
						}
						if from != "" {
							body = "From: " + from + " — " + subj
						} else {
							body = subj
						}
					case "inbox.expired":
						title = "Inbox Expired"
						if s, ok := m["full_address"].(string); ok {
							body = s
						} else {
							body = "An inbox has expired"
						}
					default:
						title = evt.Message.Type
						if s, ok := m["full_address"].(string); ok {
							body = s
						}
					}
					inboxID := &evt.InboxID
					if err := notifRepo.Create(ctx, evt.UserID, evt.Message.Type, title, body, inboxID); err != nil {
						slog.Error("failed to persist notification", "error", err)
					}
				}
				if counterRepo != nil && evt.Message.Type == "email.received" && evt.OrgID != uuid.Nil {
					if err := counterRepo.IncrementEmail(ctx, evt.OrgID, evt.SizeBytes); err != nil {
						slog.Error("failed to increment email counter", "error", err)
					}
					if err := counterRepo.UpsertDailyStat(ctx, evt.OrgID, 1, 0, evt.SizeBytes); err != nil {
						slog.Error("failed to upsert daily stat", "error", err)
					}
					if evt.Hour >= 0 {
						if err := counterRepo.UpsertHourlyStat(ctx, evt.OrgID, evt.Hour); err != nil {
							slog.Error("failed to upsert hourly stat", "error", err)
						}
					}
					if evt.DomainName != "" {
						if err := counterRepo.UpsertDomainStat(ctx, evt.OrgID, evt.DomainName); err != nil {
							slog.Error("failed to upsert domain stat", "error", err)
						}
					}
					if evt.SenderDomain != "" {
						if err := counterRepo.UpsertSenderDomainStat(ctx, evt.OrgID, evt.SenderDomain); err != nil {
							slog.Error("failed to upsert sender domain stat", "error", err)
						}
					}
					if evt.TeamID != uuid.Nil {
						if err := counterRepo.IncrementTeamEmail(ctx, evt.TeamID, evt.SizeBytes); err != nil {
							slog.Error("failed to increment team email counter", "error", err)
						}
						if err := counterRepo.UpsertDailyTeamStat(ctx, evt.TeamID, 1, 0, evt.SizeBytes); err != nil {
							slog.Error("failed to upsert daily team stat", "error", err)
						}
					}
				}
			}
			// Channel closed — Redis disconnected
			sub.Close()
			slog.Warn("redis subscription lost, reconnecting in 5s")
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
		}
	}()
}
