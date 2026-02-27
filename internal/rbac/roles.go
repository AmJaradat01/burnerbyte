package rbac

// Org-level roles
const (
	OrgOwner  = "owner"
	OrgAdmin  = "admin"
	OrgMember = "member"
)

// Team-level roles
const (
	TeamLead   = "lead"
	TeamMember = "member"
	TeamViewer = "viewer"
)

type Resource string

const (
	ResourceOrg              Resource = "org"
	ResourceOrgSettings      Resource = "org.settings"
	ResourceOrgMembers       Resource = "org.members"
	ResourceDomain           Resource = "domain"
	ResourceTeam             Resource = "team"
	ResourceTeamMembers      Resource = "team.members"
	ResourceDomainAssignment Resource = "domain_assignment"
	ResourceInbox            Resource = "inbox"
	ResourceEmail            Resource = "email"
	ResourceWebhook          Resource = "webhook"
	ResourceAPIKey           Resource = "api_key"
	ResourceAnalytics        Resource = "analytics"
	ResourceAuditLog         Resource = "audit_log"
)

type Action string

const (
	ActionCreate      Action = "create"
	ActionRead        Action = "read"
	ActionUpdate      Action = "update"
	ActionDelete      Action = "delete"
	ActionManage      Action = "manage"
	ActionInvite      Action = "invite"
	ActionRemove      Action = "remove"
	ActionChangeRole  Action = "change_role"
	ActionVerify      Action = "verify"
	ActionAssign      Action = "assign"
	ActionUnassign    Action = "unassign"
	ActionExtendTTL   Action = "extend_ttl"
	ActionDownload    Action = "download"
	ActionRevoke      Action = "revoke"
)
