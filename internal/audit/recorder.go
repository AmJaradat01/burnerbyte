package audit

import (
	"context"
	"log/slog"
	"net"
	"net/http"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

// SeverityMap maps action strings to their severity classification.
var SeverityMap = map[string]string{
	// critical
	"user.password_changed":           "critical",
	"user.password_reset":             "critical",
	"user.account_deleted":            "critical",
	"admin.user_deleted":              "critical",
	"admin.sessions_revoked":          "critical",
	"admin.sso_config_updated":        "critical",
	"admin.platform_settings_updated": "critical",
	"member.role_changed":             "critical",
	"admin.role_created":              "critical",
	"admin.role_updated":              "critical",
	"admin.role_deleted":              "critical",
	"org.deleted":                     "critical",
	// warning
	"member.removed":       "warning",
	"member.invited":       "warning",
	"team.deleted":         "warning",
	"domain.deleted":       "warning",
	"domain.unassigned":    "warning",
	"webhook.deleted":      "warning",
	"apikey.revoked":       "warning",
	"inbox.deleted":        "warning",
	"email.deleted":        "warning",
	"admin.user_updated":   "warning",
	"org.updated":          "warning",
	"org.settings.updated": "warning",
}

// CategoryMap maps action strings to their category classification.
var CategoryMap = map[string]string{
	// auth
	"user.registered":       "auth",
	"user.login":            "auth",
	"user.sso_login":        "auth",
	"user.logout":           "auth",
	"user.password_changed": "auth",
	"user.password_reset":   "auth",
	"user.account_deleted":  "auth",
	"user.profile_updated":  "auth",
	"user.email_verified":   "auth",
	"session.revoked":       "auth",
	"session.revoked_all":   "auth",
	// org
	"org.created":          "org",
	"org.updated":          "org",
	"org.deleted":          "org",
	"org.settings.updated": "org",
	// member
	"member.invited":      "member",
	"member.role_changed": "member",
	"member.removed":      "member",
	"invite.revoked":      "member",
	"invite.accepted":     "member",
	// team
	"team.created":             "team",
	"team.updated":             "team",
	"team.deleted":             "team",
	"team.member_added":        "team",
	"team.member_removed":      "team",
	"team.member_role_changed": "team",
	// domain
	"domain.created":            "domain",
	"domain.updated":            "domain",
	"domain.deleted":            "domain",
	"domain.verified":           "domain",
	"domain.assigned":           "domain",
	"domain.unassigned":         "domain",
	"domain_assignment.updated": "domain",
	// inbox
	"inbox.created":  "inbox",
	"inbox.deleted":  "inbox",
	"inbox.extended": "inbox",
	// email
	"email.deleted":  "email",
	"email.all_read": "email",
	// webhook
	"webhook.created": "webhook",
	"webhook.updated": "webhook",
	"webhook.deleted": "webhook",
	// apikey
	"apikey.created": "apikey",
	"apikey.revoked": "apikey",
	// admin
	"admin.user_deleted":              "admin",
	"admin.user_updated":              "admin",
	"admin.sessions_revoked":          "admin",
	"admin.platform_settings_updated": "admin",
	"admin.sso_config_updated":        "admin",
	"admin.role_created":              "admin",
	"admin.role_updated":              "admin",
	"admin.role_deleted":              "admin",
}

// GetSeverity returns the severity for the given action, defaulting to "info".
func GetSeverity(action string) string {
	if s, ok := SeverityMap[action]; ok {
		return s
	}
	return "info"
}

// GetCategory returns the category for the given action, defaulting to "".
func GetCategory(action string) string {
	if c, ok := CategoryMap[action]; ok {
		return c
	}
	return ""
}

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

// RecordEnhanced records an audit entry with all enhanced fields populated.
func (rec *Recorder) RecordEnhanced(r *http.Request, orgID uuid.UUID, action, resourceType string, resourceID uuid.UUID, resourceName string, metadata map[string]any) {
	uc := auth.GetUser(r.Context())
	var actorID *uuid.UUID
	var actorDisplayName string
	if uc != nil {
		actorID = &uc.UserID
		actorDisplayName = uc.DisplayName
	}

	userAgent := r.Header.Get("User-Agent")
	severity := GetSeverity(action)
	category := GetCategory(action)

	ip := stripPort(r.RemoteAddr)
	var ipPtr *string
	if ip != "" {
		ipPtr = &ip
	}

	entry := &domain.AuditEntry{
		OrgID:            orgID,
		ActorID:          actorID,
		Action:           action,
		ResourceType:     resourceType,
		ResourceID:       resourceID,
		ResourceName:     resourceName,
		Metadata:         metadata,
		IPAddress:        ipPtr,
		UserAgent:        userAgent,
		ActorDisplayName: actorDisplayName,
		Severity:         severity,
		Category:         category,
	}
	if err := rec.svc.Record(r.Context(), entry); err != nil {
		slog.Error("audit record failed", "error", err, "action", action)
	}
}

func stripPort(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}
