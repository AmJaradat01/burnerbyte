package domain

type OrgStats struct {
	TotalEmails      int64            `json:"total_emails"`
	TotalInboxes     int64            `json:"total_inboxes"`
	ActiveInboxes    int64            `json:"active_inboxes"`
	TotalDomains     int64            `json:"total_domains"`
	TotalTeams       int64            `json:"total_teams"`
	TotalMembers     int64            `json:"total_members"`
	StorageUsedBytes int64            `json:"storage_used_bytes"`
	TopSenderDomains []SenderDomain   `json:"top_sender_domains"`
}

type TeamStats struct {
	TotalEmails   int64             `json:"total_emails"`
	TotalInboxes  int64             `json:"total_inboxes"`
	ActiveInboxes int64             `json:"active_inboxes"`
	TotalMembers  int64             `json:"total_members"`
}

type SenderDomain struct {
	Domain string `json:"domain"`
	Count  int64  `json:"count"`
}

type TimeSeriesPoint struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

type HourlyPoint struct {
	Hour  int   `json:"hour"`
	Count int64 `json:"count"`
}

type DomainBreakdown struct {
	Domain string `json:"domain"`
	Count  int64  `json:"count"`
}

type SystemStats struct {
	TotalUsers      int64 `json:"total_users"`
	TotalOrgs       int64 `json:"total_orgs"`
	TotalTeams      int64 `json:"total_teams"`
	TotalDomains    int64 `json:"total_domains"`
	TotalEmails     int64 `json:"total_emails"`
	TotalInboxes    int64 `json:"total_inboxes"`
	ActiveInboxes   int64 `json:"active_inboxes"`
	TotalSessions   int64 `json:"total_sessions"`
}
