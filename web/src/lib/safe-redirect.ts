/**
 * Returns a safe in-app redirect path. Only same-origin absolute paths are
 * allowed; protocol-relative ("//evil"), absolute URLs ("https://…", "http://…",
 * "javascript:…"), and anything not starting with "/" fall back to /.
 * This prevents open redirects after login / SSO via a ?redirect= parameter.
 */
export function safeRedirect(url: string | null): string {
  if (!url) return "/";
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("://")) {
    return "/";
  }
  return url;
}
