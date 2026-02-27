package audit

import (
	"context"
	"log/slog"
	"net"
	"net/http"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type Recorder struct {
	svc *service.AuditService
}

func NewRecorder(svc *service.AuditService) *Recorder {
	return &Recorder{svc: svc}
}

func (rec *Recorder) Record(ctx context.Context, orgID uuid.UUID, actorID *uuid.UUID, action, resourceType string, resourceID uuid.UUID, metadata any, ip string) {
	ip = stripPort(ip)
	var ipPtr *string
	if ip != "" {
		ipPtr = &ip
	}
	entry := &domain.AuditEntry{
		OrgID: orgID, ActorID: actorID, Action: action,
		ResourceType: resourceType, ResourceID: resourceID,
		Metadata: metadata, IPAddress: ipPtr,
	}
	if err := rec.svc.Record(ctx, entry); err != nil {
		slog.Error("audit record failed", "error", err, "action", action)
	}
}

func (rec *Recorder) RecordFromRequest(r *http.Request, orgID uuid.UUID, action, resourceType string, resourceID uuid.UUID, metadata any) {
	uc := auth.GetUser(r.Context())
	var actorID *uuid.UUID
	if uc != nil {
		actorID = &uc.UserID
	}
	rec.Record(r.Context(), orgID, actorID, action, resourceType, resourceID, metadata, r.RemoteAddr)
}

func stripPort(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}
