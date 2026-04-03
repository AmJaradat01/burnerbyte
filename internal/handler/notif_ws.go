package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/realtime"
)

type NotifWSHandler struct {
	hub     *realtime.NotifHub
	origins []string
}

func NewNotifWSHandler(hub *realtime.NotifHub, origins []string) *NotifWSHandler {
	return &NotifWSHandler{hub: hub, origins: origins}
}

func (h *NotifWSHandler) NotificationsWS(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true
			}
			for _, o := range h.origins {
				if o == "*" || o == origin {
					return true
				}
			}
			return false
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("notif ws upgrade failed", "error", err)
		return
	}

	client := &realtime.NotifClient{UserID: uc.UserID, Send: make(chan []byte, 64)}
	h.hub.Register(client)
	slog.Info("notif ws connected", "user_id", uc.UserID)

	done := make(chan struct{})

	// Writer
	go func() {
		pingTicker := time.NewTicker(wsPingPeriod)
		defer pingTicker.Stop()
		defer conn.Close()
		for {
			select {
			case msg, ok := <-client.Send:
				if !ok {
					conn.WriteMessage(websocket.CloseMessage, nil)
					return
				}
				conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			case <-pingTicker.C:
				conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			case <-done:
				return
			}
		}
	}()

	// Reader (just handles pong/close)
	conn.SetReadLimit(512)
	conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(wsPongWait))
		return nil
	})
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
	close(done)
	h.hub.Unregister(client)
	slog.Info("notif ws disconnected", "user_id", uc.UserID)
}
