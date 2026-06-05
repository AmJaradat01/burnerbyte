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
// Show a short form instead of a raw 36-character id in the trail.
function displayLabel(seg: string): string {
  if (labels[seg]) return labels[seg];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return seg.slice(0, 8) + "…";
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
          const label = displayLabel(seg);
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
