// Pure SSO provider helpers extracted from the settings SSO tab so the
// validation and summary logic can be unit-tested without rendering the page.

export interface SSOProviderFormFields {
  name?: string;
  client_id?: string;
  client_secret?: string;
  redirect_url?: string;
}

/** isValidProviderUrl reports whether value parses as an absolute URL. */
export function isValidProviderUrl(value: string): boolean {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * validateSSOProviderForm returns a map of field -> error message for the
 * required provider fields, with inline URL-format validation for redirect_url.
 * An empty map means the form is valid.
 */
export function validateSSOProviderForm(form: SSOProviderFormFields): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!form.name?.trim()) errs.name = "Name is required";
  if (!form.client_id?.trim()) errs.client_id = "Client ID is required";
  if (!form.client_secret?.trim()) errs.client_secret = "Client Secret is required";
  if (!form.redirect_url?.trim()) errs.redirect_url = "Redirect URL is required";
  else if (!isValidProviderUrl(form.redirect_url)) errs.redirect_url = "Invalid URL format";
  return errs;
}

export interface SSOSummarySource {
  enabled: boolean;
  linked_user_count?: number;
}

/** ssoSummaryStats aggregates the provider list for the SSO tab header. */
export function ssoSummaryStats(providers: SSOSummarySource[]): {
  enabledCount: number;
  totalLinkedUsers: number;
} {
  return {
    enabledCount: providers.filter((p) => p.enabled).length,
    totalLinkedUsers: providers.reduce((sum, p) => sum + (p.linked_user_count ?? 0), 0),
  };
}
