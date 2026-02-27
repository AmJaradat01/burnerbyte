package rbac

type Permission struct {
	Resource Resource
	Action   Action
}

// rolePermissions maps role → set of allowed permissions.
// Org roles and team roles are in separate maps.
var orgRolePermissions = map[string]map[Permission]bool{
	OrgOwner: {
		{ResourceOrg, ActionRead}: true, {ResourceOrg, ActionUpdate}: true, {ResourceOrg, ActionDelete}: true,
		{ResourceOrgSettings, ActionManage}: true,
		{ResourceOrgMembers, ActionInvite}: true, {ResourceOrgMembers, ActionRemove}: true, {ResourceOrgMembers, ActionChangeRole}: true,
		{ResourceDomain, ActionCreate}: true, {ResourceDomain, ActionRead}: true, {ResourceDomain, ActionUpdate}: true,
		{ResourceDomain, ActionDelete}: true, {ResourceDomain, ActionVerify}: true,
		{ResourceDomain, ActionAssign}: true, {ResourceDomain, ActionUnassign}: true,
		{ResourceTeam, ActionCreate}: true, {ResourceTeam, ActionRead}: true, {ResourceTeam, ActionUpdate}: true, {ResourceTeam, ActionDelete}: true,
		{ResourceTeamMembers, ActionInvite}: true, {ResourceTeamMembers, ActionRemove}: true, {ResourceTeamMembers, ActionChangeRole}: true,
		{ResourceDomainAssignment, ActionRead}: true, {ResourceDomainAssignment, ActionUpdate}: true,
		{ResourceInbox, ActionCreate}: true, {ResourceInbox, ActionRead}: true, {ResourceInbox, ActionExtendTTL}: true, {ResourceInbox, ActionDelete}: true,
		{ResourceEmail, ActionRead}: true, {ResourceEmail, ActionDownload}: true, {ResourceEmail, ActionDelete}: true,
		{ResourceWebhook, ActionCreate}: true, {ResourceWebhook, ActionRead}: true, {ResourceWebhook, ActionDelete}: true,
		{ResourceAPIKey, ActionCreate}: true, {ResourceAPIKey, ActionRead}: true, {ResourceAPIKey, ActionRevoke}: true,
		{ResourceAnalytics, ActionRead}: true,
		{ResourceAuditLog, ActionRead}: true,
	},
	OrgAdmin: {
		{ResourceOrg, ActionRead}: true, {ResourceOrg, ActionUpdate}: true,
		{ResourceOrgSettings, ActionManage}: true,
		{ResourceOrgMembers, ActionInvite}: true, {ResourceOrgMembers, ActionRemove}: true,
		{ResourceDomain, ActionCreate}: true, {ResourceDomain, ActionRead}: true, {ResourceDomain, ActionUpdate}: true,
		{ResourceDomain, ActionDelete}: true, {ResourceDomain, ActionVerify}: true,
		{ResourceDomain, ActionAssign}: true, {ResourceDomain, ActionUnassign}: true,
		{ResourceTeam, ActionCreate}: true, {ResourceTeam, ActionRead}: true, {ResourceTeam, ActionUpdate}: true, {ResourceTeam, ActionDelete}: true,
		{ResourceTeamMembers, ActionInvite}: true, {ResourceTeamMembers, ActionRemove}: true, {ResourceTeamMembers, ActionChangeRole}: true,
		{ResourceDomainAssignment, ActionRead}: true, {ResourceDomainAssignment, ActionUpdate}: true,
		{ResourceInbox, ActionCreate}: true, {ResourceInbox, ActionRead}: true, {ResourceInbox, ActionExtendTTL}: true, {ResourceInbox, ActionDelete}: true,
		{ResourceEmail, ActionRead}: true, {ResourceEmail, ActionDownload}: true, {ResourceEmail, ActionDelete}: true,
		{ResourceWebhook, ActionCreate}: true, {ResourceWebhook, ActionRead}: true, {ResourceWebhook, ActionDelete}: true,
		{ResourceAPIKey, ActionCreate}: true, {ResourceAPIKey, ActionRead}: true, {ResourceAPIKey, ActionRevoke}: true,
		{ResourceAnalytics, ActionRead}: true,
		{ResourceAuditLog, ActionRead}: true,
	},
	OrgMember: {
		{ResourceOrg, ActionRead}: true,
		{ResourceDomain, ActionRead}: true,
		{ResourceTeam, ActionRead}: true,
		{ResourceDomainAssignment, ActionRead}: true,
	},
}

var teamRolePermissions = map[string]map[Permission]bool{
	TeamLead: {
		{ResourceTeam, ActionUpdate}: true,
		{ResourceTeamMembers, ActionInvite}: true, {ResourceTeamMembers, ActionRemove}: true, {ResourceTeamMembers, ActionChangeRole}: true,
		{ResourceDomainAssignment, ActionRead}: true, {ResourceDomainAssignment, ActionUpdate}: true,
		{ResourceInbox, ActionCreate}: true, {ResourceInbox, ActionRead}: true, {ResourceInbox, ActionExtendTTL}: true, {ResourceInbox, ActionDelete}: true,
		{ResourceEmail, ActionRead}: true, {ResourceEmail, ActionDownload}: true, {ResourceEmail, ActionDelete}: true,
		{ResourceWebhook, ActionCreate}: true, {ResourceWebhook, ActionRead}: true, {ResourceWebhook, ActionDelete}: true,
		{ResourceAPIKey, ActionCreate}: true, {ResourceAPIKey, ActionRead}: true, {ResourceAPIKey, ActionRevoke}: true,
		{ResourceAnalytics, ActionRead}: true,
	},
	TeamMember: {
		{ResourceDomainAssignment, ActionRead}: true,
		{ResourceInbox, ActionCreate}: true, {ResourceInbox, ActionRead}: true, {ResourceInbox, ActionExtendTTL}: true, {ResourceInbox, ActionDelete}: true,
		{ResourceEmail, ActionRead}: true, {ResourceEmail, ActionDownload}: true, {ResourceEmail, ActionDelete}: true,
		{ResourceWebhook, ActionRead}: true,
		{ResourceAPIKey, ActionRead}: true,
		{ResourceAnalytics, ActionRead}: true,
	},
	TeamViewer: {
		{ResourceDomainAssignment, ActionRead}: true,
		{ResourceDomain, ActionRead}: true,
		{ResourceInbox, ActionRead}: true,
		{ResourceEmail, ActionRead}: true,
		{ResourceAnalytics, ActionRead}: true,
	},
}

func OrgRoleHasPermission(role string, resource Resource, action Action) bool {
	perms, ok := orgRolePermissions[role]
	if !ok {
		return false
	}
	return perms[Permission{resource, action}]
}

func TeamRoleHasPermission(role string, resource Resource, action Action) bool {
	perms, ok := teamRolePermissions[role]
	if !ok {
		return false
	}
	return perms[Permission{resource, action}]
}
