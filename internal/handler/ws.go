package handler

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/amjaradat01/burnerbyte/internal/auth"
	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/realtime"
)

const (
	// Time allowed to write a message to the peer.
	wsWriteWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	wsPongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	wsPingPeriod = (wsPongWait * 9) / 10

	// Maximum message size allowed from peer (control frames only).
	wsMaxMessageSize = 512
)

// InboxGetter is the minimal interface for verifying inbox ownership.
type InboxGetter interface {
	GetByID(ctx context.Context, id uuid.UUID) (*domain.Inbox, error)
}

type WSHandler struct {
	hub            *realtime.Hub
	inboxGetter    InboxGetter
	allowedOrigins []string
}

func NewWSHandler(hub *realtime.Hub, inboxGetter InboxGetter, allowedOrigins []string) *WSHandler {
	return &WSHandler{
		hub:            hub,
		inboxGetter:    inboxGetter,
		allowedOrigins: allowedOrigins,
	}
}

func (h *WSHandler) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // Non-browser clients
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	originHost := u.Hostname()
	for _, allowed := range h.allowedOrigins {
		if allowed == "*" {
			return true
		}
		au, err := url.Parse(allowed)
		if err != nil {
			continue // Skip unparseable entries
		}
		if strings.EqualFold(au.Hostname(), originHost) {
			return true
		}
	}
	return false
}

// InboxWS upgrades the connection to WebSocket and streams real-time email
// notifications for the given inbox. Only the inbox creator can connect.
func (h *WSHandler) InboxWS(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	inboxID, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		http.Error(w, `{"error":"invalid inbox ID"}`, http.StatusBadRequest)
		return
	}

	// Verify inbox exists and the user owns it
	inbox, err := h.inboxGetter.GetByID(r.Context(), inboxID)
	if err != nil {
		http.Error(w, `{"error":"inbox not found"}`, http.StatusNotFound)
		return
	}
	if inbox.CreatedBy != uc.UserID {
		http.Error(w, `{"error":"forbidden: not your inbox"}`, http.StatusForbidden)
		return
	}
	if !inbox.IsActive || time.Now().After(inbox.ExpiresAt) {
		http.Error(w, `{"error":"inbox expired"}`, http.StatusGone)
		return
	}

	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     h.checkOrigin,
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade failed", "error", err, "inbox_id", inboxID)
		return
	}

	client := &realtime.Client{
		InboxID: inboxID,
		UserID:  uc.UserID,
		Send:    make(chan []byte, 256),
	}
	if !h.hub.Register(client) {
		conn.Close()
		return
	}

	slog.Info("ws client connected", "inbox_id", inboxID, "user_id", uc.UserID)

	// Both goroutines coordinate via this channel: when the reader exits
	// (client disconnect), it signals the writer to stop.
	done := make(chan struct{})

	// Writer goroutine: sends messages from the hub and periodic pings.
	go func() {
		ticker := time.NewTicker(wsPingPeriod)
		defer func() {
			ticker.Stop()
			conn.Close()
		}()
		for {
			select {
			case msg, ok := <-client.Send:
				conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if !ok {
					// Hub closed the channel (unregistered).
					conn.WriteMessage(websocket.CloseMessage, []byte{})
					return
				}
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					slog.Debug("ws write error", "error", err, "inbox_id", inboxID)
					return
				}
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			case <-done:
				return
			}
		}
	}()

	// Reader goroutine: reads to detect client disconnect and handle pongs.
	go func() {
		defer func() {
			close(done)
			h.hub.Unregister(client)
			slog.Info("ws client disconnected", "inbox_id", inboxID, "user_id", uc.UserID)
		}()
		conn.SetReadLimit(wsMaxMessageSize)
		conn.SetReadDeadline(time.Now().Add(wsPongWait))
		conn.SetPongHandler(func(appData string) error {
			conn.SetReadDeadline(time.Now().Add(wsPongWait))
			return nil
		})
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err,
					websocket.CloseGoingAway,
					websocket.CloseNormalClosure,
					websocket.CloseNoStatusReceived,
				) {
					slog.Debug("ws unexpected close", "error", err, "inbox_id", inboxID)
				}
				return
			}
		}
	}()
}
