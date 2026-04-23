package realtime

import (
	"encoding/json"
	"sync"
)

// AdminClient represents a connected admin WebSocket client.
type AdminClient struct {
	Send      chan []byte
	closeOnce sync.Once
}

func (c *AdminClient) Close() {
	c.closeOnce.Do(func() { close(c.Send) })
}

// AdminHub broadcasts messages to all connected admin clients.
type AdminHub struct {
	mu      sync.RWMutex
	clients map[*AdminClient]bool
}

func NewAdminHub() *AdminHub {
	return &AdminHub{clients: make(map[*AdminClient]bool)}
}

func (h *AdminHub) Register(c *AdminClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = true
}

func (h *AdminHub) Unregister(c *AdminClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	c.Close()
}

// Broadcast sends a message to all connected admin clients.
func (h *AdminHub) Broadcast(msg any) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.Send <- data:
		default:
			// Client buffer full, skip
		}
	}
}

// ClientCount returns the number of connected admin clients.
func (h *AdminHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// CloseAll closes all connected admin clients.
func (h *AdminHub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		c.Close()
	}
	h.clients = make(map[*AdminClient]bool)
}
