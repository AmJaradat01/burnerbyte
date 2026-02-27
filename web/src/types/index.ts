export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  is_system_admin: boolean;
  email_verified: boolean;
  created_at: string;
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
}

export interface Team {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface Domain {
  id: string;
  org_id: string;
  domain_name: string;
  mx_verified: boolean;
  txt_verified: boolean;
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
