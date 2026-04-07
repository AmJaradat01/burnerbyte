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
	InboxID uuid.UUID `json:"inbox_id"`
	UserID  uuid.UUID `json:"user_id"`
	Message Message   `json:"message"`
}

// Publisher — used by smtpd to publish events to Redis.
type Publisher struct {
	rdb *redis.Client
}

func NewPublisher(rdb *redis.Client) *Publisher {
	return &Publisher{rdb: rdb}
}

func (p *Publisher) PublishInboxEvent(ctx context.Context, inboxID, userID uuid.UUID, msg Message) {
	evt := InboxEvent{InboxID: inboxID, UserID: userID, Message: msg}
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
	Create(ctx context.Context, userID uuid.UUID, typ, title, message string) error
}

// Subscribe — used by API server to receive events and forward to hubs.
func Subscribe(ctx context.Context, rdb *redis.Client, hub *Hub, notifHub *NotifHub, notifRepo NotificationPersister) {
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
				title := evt.Message.Type
				var body string
				if m, ok := evt.Message.Data.(map[string]interface{}); ok {
					if s, ok := m["subject"].(string); ok {
						body = s
					} else if s, ok := m["full_address"].(string); ok {
						body = s
					}
				}
				if err := notifRepo.Create(ctx, evt.UserID, evt.Message.Type, title, body); err != nil {
					slog.Error("failed to persist notification", "error", err)
				}
			}
		}
	}()
}
