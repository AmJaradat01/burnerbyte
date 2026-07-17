"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const labels: Record<string, string> = {
  dashboard: "Dashboard",
  inboxes: "Inboxes",
  domains: "Domains",
  teams: "Teams",
  webhooks: "Webhooks",
  "api-keys": "API Keys",
  audit: "Audit Log",
  analytics: "Analytics",
  settings: "Settings",
  admin: "Admin",
  profile: "Profile",
  sessions: "Sessions",
  email: "Email",
  delete: "Delete Account",
};

// Dynamic route segments are entity UUIDs (inbox / email / domain ids).
// Show a human-readable label instead of raw 36-character ids.
function displayLabel(seg: string, segments: string[], index: number): string {
  if (labels[seg]) return labels[seg];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) {
    // Contextual label based on parent segment
    const parent = index > 0 ? segments[index - 1] : "";
    if (parent === "inboxes") return "Inbox";
    if (parent === "email") return "Message";
    if (parent === "domains") return "Domain";
    if (parent === "teams") return "Team";
    return seg.slice(0, 8) + "…";
  }
  return seg;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
      <ol className="flex items-center gap-1">
        {segments.map((seg, i) => {
          const href = "/" + segments.slice(0, i + 1).join("/");
          const label = displayLabel(seg, segments, i);
          const isLast = i === segments.length - 1;
          return (
            <li key={href} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
              {isLast ? (
                <span className="text-foreground font-medium">{label}</span>
              ) : (
                <Link href={href} className="hover:underline">{label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
