package realtime

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	ChannelInbox = "bb:inbox"
	ChannelNotif = "bb:notif"
)

type InboxEvent struct {
	InboxID   uuid.UUID `json:"inbox_id"`
	UserID    uuid.UUID `json:"user_id"`
	OrgID     uuid.UUID `json:"org_id"`
	SizeBytes int64     `json:"size_bytes"`
	Message   Message   `json:"message"`
}

// Publisher — used by smtpd to publish events to Redis.
type Publisher struct {
	rdb *redis.Client
}

func NewPublisher(rdb *redis.Client) *Publisher {
	return &Publisher{rdb: rdb}
}

func (p *Publisher) PublishInboxEvent(ctx context.Context, inboxID, userID, orgID uuid.UUID, sizeBytes int64, msg Message) {
	evt := InboxEvent{InboxID: inboxID, UserID: userID, OrgID: orgID, SizeBytes: sizeBytes, Message: msg}
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
}

// Subscribe — used by API server to receive events and forward to hubs.
func Subscribe(ctx context.Context, rdb *redis.Client, hub *Hub, notifHub *NotifHub, notifRepo NotificationPersister, counterRepo CounterPersister) {
	sub := rdb.Subscribe(ctx, ChannelInbox)
	ch := sub.Channel()
	go func() {
		defer sub.Close()
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
					if subj == "" { subj = "(no subject)" }
					if from != "" {
						body = "From: " + from + " — " + subj
					} else {
						body = subj
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
			}
		}
	}()
}
