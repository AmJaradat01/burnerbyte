package audit

import (
	"context"
	"log/slog"
	"net"
	"net/http"

	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/auth"
	"github.com/amjaradat01/burnerbyte/internal/clientip"
	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/service"
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
	"admin.sso_provider_created":      "critical",
	"admin.sso_provider_deleted":      "critical",
	"team.transferred":                "critical",
	// warning
	"member.removed":              "warning",
	"member.deactivated":          "warning",
	"member.invited":              "warning",
	"team.deleted":                "warning",
	"team.archived":               "warning",
	"team.restored":               "info",
	"team.member_left":            "info",
	"team.members_bulk_added":     "info",
	"team.members_bulk_removed":   "warning",
	"domain.deleted":              "warning",
	"domain.unassigned":    "warning",
	"webhook.deleted":      "warning",
	"apikey.revoked":       "warning",
	"inbox.deleted":        "warning",
	"email.deleted":        "warning",
	"admin.user_updated":   "warning",
	"org.updated":          "warning",
	"org.settings.updated": "warning",
	// new events
	"user.login_failed":      "warning",
	"user.locked":            "critical",
	"user.forgot_password":   "info",
	"user.sso_login_failed":  "warning",
	"user.sso_linked":        "info",
	"user.sso_unlinked":      "warning",
	"user.sso_enforced":      "warning",
	"admin.sso_test":         "info",
	"apikey.disabled":        "warning",
	"apikey.enabled":         "info",
	"apikey.updated":         "warning",
	"apikey.rotated":         "warning",
	"apikey.bulk_revoked":    "warning",
	"domain.settings_updated": "info",
	"notification.deleted":     "info",
	"notification.all_deleted": "info",
	// auth migration & method lock
	"admin.auth_migrated":            "critical",
	"admin.auth_method_lock_changed": "critical",
	"user.login_session_conflict":    "warning",
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
	"member.deactivated":  "member",
	"invite.revoked":      "member",
	"invite.accepted":     "member",
	// team
	"team.created":             "team",
	"team.updated":             "team",
	"team.deleted":             "team",
	"team.archived":            "team",
	"team.restored":            "team",
	"team.member_added":        "team",
	"team.member_removed":      "team",
	"team.member_role_changed": "team",
	"team.member_left":         "team",
	"team.members_bulk_added":  "team",
	"team.members_bulk_removed": "team",
	"team.transferred":         "team",
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
	"inbox.expired":  "inbox",
	// email
	"email.received": "email",
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
	// new events
	"user.login_failed":      "auth",
	"user.locked":            "auth",
	"user.forgot_password":   "auth",
	"user.sso_login_failed":  "auth",
	"user.sso_linked":        "auth",
	"user.sso_unlinked":      "auth",
	"user.sso_enforced":      "auth",
	"admin.sso_provider_created": "admin",
	"admin.sso_provider_deleted": "admin",
	"admin.sso_test":             "admin",
	"apikey.disabled":        "apikey",
	"apikey.enabled":         "apikey",
	"apikey.updated":         "apikey",
	"apikey.rotated":         "apikey",
	"apikey.bulk_revoked":    "apikey",
	"domain.settings_updated": "domain",
	"notification.deleted":     "notification",
	"notification.all_deleted": "notification",
	// auth migration & method lock
	"admin.auth_migrated":            "admin",
	"admin.auth_method_lock_changed": "admin",
	"user.login_session_conflict":    "auth",
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

// RecordWithName records an audit entry with resource_name, severity, and category set.
// Use for system-initiated events (SMTP, workers) that don't have an HTTP request.
func (rec *Recorder) RecordWithName(ctx context.Context, orgID uuid.UUID, actorID *uuid.UUID, action, resourceType string, resourceID uuid.UUID, resourceName string, metadata any) {
	entry := &domain.AuditEntry{
		OrgID:        orgID,
		ActorID:      actorID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		ResourceName: resourceName,
		Metadata:     metadata,
		Severity:     GetSeverity(action),
		Category:     GetCategory(action),
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
	rec.Record(r.Context(), orgID, actorID, action, resourceType, resourceID, metadata, clientip.From(r))
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

	ip := stripPort(clientip.From(r))
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
