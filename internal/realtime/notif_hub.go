package realtime

import (
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/google/uuid"
)

type NotifClient struct {
	UserID    uuid.UUID
	Send      chan []byte
	closeOnce sync.Once
}

func (c *NotifClient) Close() {
	c.closeOnce.Do(func() { close(c.Send) })
}

type NotifHub struct {
	mu      sync.RWMutex
	clients map[uuid.UUID]map[*NotifClient]bool
}

func NewNotifHub() *NotifHub {
	return &NotifHub{clients: make(map[uuid.UUID]map[*NotifClient]bool)}
}

func (h *NotifHub) Register(c *NotifClient) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients := h.clients[c.UserID]; len(clients) >= 5 {
		c.Close()
		return false
	}
	if h.clients[c.UserID] == nil {
		h.clients[c.UserID] = make(map[*NotifClient]bool)
	}
	h.clients[c.UserID][c] = true
	slog.Debug("notif client registered", "user_id", c.UserID)
	return true
}

func (h *NotifHub) Unregister(c *NotifClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.clients[c.UserID]; ok {
		delete(clients, c)
		if len(clients) == 0 {
			delete(h.clients, c.UserID)
		}
	}
	c.Close() // Safe: sync.Once prevents double-close panic
}

func (h *NotifHub) Notify(userID uuid.UUID, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients[userID] {
		select {
		case c.Send <- data:
		default:
		}
	}
}

func (h *NotifHub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, clients := range h.clients {
		for c := range clients {
			c.Close() // Safe: sync.Once prevents double-close
		}
	}
	h.clients = make(map[uuid.UUID]map[*NotifClient]bool)
}
