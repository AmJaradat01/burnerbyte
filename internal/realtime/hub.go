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
	InboxID uuid.UUID
	Send    chan []byte
}

type Hub struct {
	mu      sync.RWMutex
	clients map[uuid.UUID]map[*Client]bool
}

func NewHub() *Hub {
	return &Hub{clients: make(map[uuid.UUID]map[*Client]bool)}
}

func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[client.InboxID] == nil {
		h.clients[client.InboxID] = make(map[*Client]bool)
	}
	h.clients[client.InboxID][client] = true
	slog.Debug("ws client registered", "inbox_id", client.InboxID)
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.clients[client.InboxID]; ok {
		delete(clients, client)
		if len(clients) == 0 {
			delete(h.clients, client.InboxID)
		}
	}
	close(client.Send)
}

func (h *Hub) Broadcast(inboxID uuid.UUID, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil { return }

	h.mu.RLock()
	defer h.mu.RUnlock()

	clients := h.clients[inboxID]
	for client := range clients {
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
			close(client.Send)
		}
	}
	h.clients = make(map[uuid.UUID]map[*Client]bool)
}
