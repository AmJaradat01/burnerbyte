"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
      <ol className="flex items-center gap-1">
        {segments.map((seg, i) => {
          const href = "/" + segments.slice(0, i + 1).join("/");
          const label = labels[seg] || seg;
          const isLast = i === segments.length - 1;
          return (
            <li key={href} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
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
