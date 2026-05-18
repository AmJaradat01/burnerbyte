package realtime

import (
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/google/uuid"
)

type Message struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

type Client struct {
	InboxID   uuid.UUID
	UserID    uuid.UUID
	Send      chan []byte
	closeOnce sync.Once
}

func (c *Client) Close() {
	c.closeOnce.Do(func() { close(c.Send) })
}

type Hub struct {
	mu          sync.RWMutex
	clients     map[uuid.UUID]map[*Client]bool
	userConns   map[uuid.UUID]int
}

func NewHub() *Hub {
	return &Hub{
		clients:   make(map[uuid.UUID]map[*Client]bool),
		userConns: make(map[uuid.UUID]int),
	}
}

func (h *Hub) Register(client *Client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.userConns[client.UserID] >= 5 {
		client.Close()
		return false
	}
	if h.clients[client.InboxID] == nil {
		h.clients[client.InboxID] = make(map[*Client]bool)
	}
	h.clients[client.InboxID][client] = true
	h.userConns[client.UserID]++
	slog.Debug("ws client registered", "inbox_id", client.InboxID)
	return true
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.clients[client.InboxID]; ok {
		if clients[client] {
			delete(clients, client)
			h.userConns[client.UserID]--
			if h.userConns[client.UserID] <= 0 {
				delete(h.userConns, client.UserID)
			}
		}
		if len(clients) == 0 {
			delete(h.clients, client.InboxID)
		}
	}
	client.Close() // Safe: sync.Once prevents double-close panic
}

func (h *Hub) Broadcast(inboxID uuid.UUID, msg interface{}) {
	data, err := json.Marshal(msg)
	if err != nil { return }

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients[inboxID] {
		select {
		case client.Send <- data:
		default:
			// Client buffer full, skip
		}
	}
}

func (h *Hub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, clients := range h.clients {
		for client := range clients {
			client.Close() // Safe: sync.Once prevents double-close
		}
	}
	h.clients = make(map[uuid.UUID]map[*Client]bool)
	h.userConns = make(map[uuid.UUID]int)
}
