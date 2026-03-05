export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  sso_provider?: string;
  is_system_admin: boolean;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  settings: OrgSettings;
  created_at: string;
}

export interface OrgSettings {
  attachments_enabled?: boolean;
  default_inbox_ttl?: string;
  max_inbox_ttl?: string;
  max_attachment_size_mb?: number;
  max_domains?: number;
  max_teams?: number;
  max_inboxes_per_domain?: number;
  enforce_sso?: boolean;
  primary_color?: string;
  footer_text?: string;
}

export interface Team {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  created_at: string;
  member_count: number;
  domain_count: number;
  active_inboxes: number;
}

export interface Domain {
  id: string;
  org_id: string;
  domain_name: string;
  mx_verified: boolean;
  txt_verified: boolean;
  verification_record?: string;
  dns_last_checked_at?: string;
  created_at: string;
  active_inboxes: number;
  team_count: number;
}

export interface DomainAssignment {
  id: string;
  team_id: string;
  domain_id: string;
  domain_name?: string;
  access_level: string;
  settings: Record<string, unknown>;
  default_ttl?: string;
  max_ttl?: string;
  created_at: string;
}

export interface Inbox {
  id: string;
  domain_assignment_id: string;
  domain_id: string;
  created_by: string;
  address: string;
  full_address: string;
  is_active: boolean;
  expires_at: string;
  created_at: string;
  domain_name?: string;
  email_count: number;
  unread_count: number;
}

export interface EmailSummary {
  id: string;
  from_address: string;
  subject?: string;
  has_attachments: boolean;
  is_read: boolean;
  size_bytes: number;
  received_at: string;
}

export interface Email {
  id: string;
  inbox_id: string;
  from_address: string;
  to_address: string;
  subject?: string;
  body_text?: string;
  body_html?: string;
  has_attachments: boolean;
  size_bytes: number;
  is_read: boolean;
  received_at: string;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  email_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
}

export interface Webhook {
  id: string;
  team_id: string;
  url: string;
  events: string[];
  active: boolean;
  failure_count: number;
  last_status?: number;
  last_attempt_at?: string;
  created_at: string;
}

export interface APIKey {
  id: string;
  team_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  actor_id: string;
  actor_email?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  ip_address?: string;
  user_agent?: string;
  last_used_at: string;
  expires_at: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface Membership {
  id: string;
  user_id: string;
  role: string;
  email?: string;
  display_name?: string;
  created_at: string;
}

export interface AnalyticsStats {
  total_inboxes: number;
  active_inboxes: number;
  total_emails: number;
  total_domains: number;
  total_teams?: number;
  total_members?: number;
}

export interface EmailsPerDay {
  date: string;
  count: number;
}

export interface SystemStats {
  total_users: number;
  total_orgs: number;
  total_emails: number;
  total_inboxes: number;
  total_domains: number;
}
