package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/realtime"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type WSHandler struct {
	hub *realtime.Hub
}

func NewWSHandler(hub *realtime.Hub) *WSHandler {
	return &WSHandler{hub: hub}
}

func (h *WSHandler) InboxWS(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	inboxID, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		http.Error(w, "invalid inbox ID", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade failed", "error", err)
		return
	}

	client := &realtime.Client{
		InboxID: inboxID,
		Send:    make(chan []byte, 256),
	}
	h.hub.Register(client)

	// Writer goroutine
	go func() {
		defer conn.Close()
		for msg := range client.Send {
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				break
			}
		}
	}()

	// Reader goroutine (just reads to detect close)
	go func() {
		defer h.hub.Unregister(client)
		conn.SetReadLimit(512)
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			return nil
		})
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}()
}
