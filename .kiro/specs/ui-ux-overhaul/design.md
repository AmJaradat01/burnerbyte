# Design Document: UI/UX Overhaul

## Overview

This design covers a systematic UI/UX overhaul of the BurnerByte frontend. The overhaul spans 24 requirement groups (66 acceptance criteria) covering typography, color system, navigation, component polish, page-level improvements, micro-interactions, accessibility, loading states, data display, empty/error states, mobile experience, branding, performance, layout, command palette, footer, notifications, form UX, and data freshness.

**Key constraints:**
- Light mode only (no dark theme)
- Extend shadcn/ui components — don't rebuild them
- Tailwind CSS v4 with `@theme inline` tokens
- Keep changes simple and minimal

**Approach:** Group changes into 6 implementation phases ordered by dependency (tokens first, then components, then pages). Each phase can be implemented and verified independently.

## Architecture

### Files Changed

| Category | Files |
|----------|-------|
| **Tokens & Fonts** | `globals.css`, `layout.tsx` |
| **Shell & Navigation** | `app-shell.tsx`, `sidebar.tsx`, `top-nav.tsx`, `footer.tsx`, `breadcrumbs.tsx` |
| **Shared Components** | `button.tsx`, `input.tsx`, `badge.tsx`, `command-palette.tsx`, `shortcut-help.tsx`, `notification-center.tsx` |
| **New Utilities** | `lib/logo.tsx` (new), `lib/relative-time.tsx` (new), `lib/use-online.ts` (new), `hooks/use-unsaved-changes.ts` (new), `components/sparkline.tsx` (new), `components/page-progress.tsx` (new), `components/skip-to-content.tsx` (new), `components/offline-banner.tsx` (new), `components/last-updated.tsx` (new) |
| **Pages** | `login/page.tsx`, `page.tsx` (landing), `dashboard/page.tsx`, `settings/page.tsx`, and all list pages for empty states |
| **Branding** | `manifest.json` (new), `favicon.svg` (new), `icon-192.png` (new) |

### Dependency Additions

| Package | Purpose | Requirement |
|---------|---------|-------------|
| `@fontsource-variable/inter` | Inter font (self-hosted) | Req 1 |
| `@fontsource-variable/jetbrains-mono` | JetBrains Mono font (self-hosted) | Req 1 |
| `nprogress` | Thin top-of-page progress bar | Req 13 |

**Alternative for fonts:** Use `next/font/google` with `Inter` and `JetBrains_Mono` (zero extra deps, same result). This is the recommended approach since the project already uses `next/font/google` for Geist.

**Alternative for progress bar:** A lightweight custom implementation (~20 lines) using a CSS transition bar avoids the `nprogress` dependency. Recommended.

### Dependency Decision

Use `next/font/google` for fonts (no new package). Build a minimal progress bar component (no new package). **Net new dependencies: 0.**

## Components and Interfaces

### Phase 1: Design Tokens & Fonts (Req 1, 5)

**`globals.css` changes:**

```css
/* Replace Geist font variables with Inter / JetBrains Mono */
--font-sans: var(--font-inter);
--font-mono: var(--font-jetbrains-mono);

/* Updated color tokens (Req 5) — vibrant blue/indigo primary */
--primary: oklch(0.55 0.20 260);          /* vibrant indigo */
--primary-foreground: oklch(0.985 0 0);
--ring: oklch(0.55 0.20 260);             /* match primary */
--accent: oklch(0.94 0.015 260);          /* complement primary */
--border: oklch(0.86 0.008 260);          /* stronger contrast */

/* Sidebar tinted background (Req 3) */
--sidebar: oklch(0.965 0.008 260);
```

**`layout.tsx` changes:**

```tsx
// Replace Geist imports with Inter + JetBrains Mono
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

// Apply to <body>
<body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}>
```

### Phase 2: Shared Components (Req 2, 3, 4, 6, 12, 14, 20)

**`components/logo.tsx` (new) — Req 4:**

A reusable `<Logo />` component rendering "Burner" in foreground + "Byte" in primary color. Props: `collapsed?: boolean` (shows "B" only), `size?: "sm" | "md" | "lg"`.

```tsx
export function Logo({ collapsed, size = "md" }: LogoProps) {
  if (collapsed) return <span className="text-lg font-bold text-primary">B</span>;
  return (
    <span className={cn("font-bold tracking-tight", sizeClass[size])}>
      Burner<span className="text-primary">Byte</span>
    </span>
  );
}
```

Used in: `sidebar.tsx`, `top-nav.tsx`, `footer.tsx`, landing page header, login page, `UnauthPublicLayout`.

**`button.tsx` — Req 6.1:**

Change default size from `h-9` to `h-10`:

```diff
- default: "h-9 px-4 py-2 has-[>svg]:px-3",
+ default: "h-10 px-4 py-2 has-[>svg]:px-3",
```

**`input.tsx` — Req 6.2:**

Add subtle inner shadow:

```diff
- "... border bg-transparent px-3 py-1 text-base shadow-xs ..."
+ "... border bg-transparent px-3 py-1 text-base shadow-xs shadow-inner/5 ..."
```

Use `shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]` for the inner shadow via Tailwind arbitrary value.

**`badge.tsx` — Req 6.3:**

Add semantic color variants:

```tsx
success: "bg-emerald-100 text-emerald-700 border-emerald-200",
warning: "bg-amber-100 text-amber-700 border-amber-200",
info: "bg-blue-100 text-blue-700 border-blue-200",
```

**`breadcrumbs.tsx` — Req 19.4, 19.5:**

Replace `"/"` separator with `<ChevronRight />` icon. Ensure last segment shows current page title.

```tsx
import { ChevronRight } from "lucide-react";
// Replace: {i > 0 && <span>/</span>}
// With:    {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
```

**`shortcut-help.tsx` — Req 14.4:**

Group shortcuts by category with section headers:

```tsx
const shortcuts = {
  Navigation: [
    { key: "j", description: "Next email in list" },
    { key: "k", description: "Previous email in list" },
  ],
  Actions: [
    { key: "n", description: "Create new inbox" },
    { key: "d", description: "Delete selected email" },
  ],
  General: [
    { key: "⌘K", description: "Open command palette" },
    { key: "?", description: "Show this help" },
    { key: "Esc", description: "Close modal / deselect" },
  ],
};
```

**`command-palette.tsx` — Req 20.1–20.4:**

- Add Lucide icons to each route entry (matching sidebar icons).
- Add action commands: `{ label: "Create Inbox", path: "/", icon: Plus, group: "Actions" }`, `{ label: "Sign Out", action: "logout", icon: LogOut, group: "Actions" }`.
- Group items with section headers ("Navigation", "Actions").
- The `⌘K` hint badge is added in `app-shell.tsx` top bar area (Req 20.4).

**`components/relative-time.tsx` (new) — Req 14.1:**

A `<RelativeTime datetime={iso} />` component that renders relative text (e.g., "3m ago") with a `title` attribute showing the full ISO 8601 string. Uses `Intl.RelativeTimeFormat` or a simple helper. Updates every 60s via `useEffect`.

**`components/copyable-id.tsx` (new) — Req 14.2, 14.3:**

A `<CopyableId value={uuid} />` component that truncates the UUID to first 8 chars + "…", with a click handler that copies the full value and shows a brief "Copied" toast.

### Phase 3: Shell & Layout (Req 3, 4, 12, 13, 15, 16, 19)

**`sidebar.tsx` — Req 2, 3, 4, 5:**

- Replace emoji icons with Lucide icons in `navItems` and `manageItems`:
  ```tsx
  { href: "/", label: t("home"), icon: Home },
  { href: "/docs", label: t("docs"), icon: BookOpen },
  { href: "/dashboard", label: t("dashboard"), icon: LayoutDashboard },
  { href: "/domains", label: t("domains"), icon: Globe },
  { href: "/teams", label: t("teams"), icon: Users },
  { href: "/webhooks", label: t("webhooks"), icon: Webhook },
  { href: "/api-keys", label: t("apiKeys"), icon: KeyRound },
  { href: "/audit", label: t("auditLog"), icon: ClipboardList },
  { href: "/analytics", label: t("analytics"), icon: BarChart3 },
  { href: "/settings", label: t("settings"), icon: Settings },
  ```
- Replace `🔥` logo with `<Logo />` component.
- Apply tinted sidebar background: `bg-sidebar` (uses the new `--sidebar` token).
- Ensure collapse/expand buttons have `min-w-8 min-h-8` (32×32px tap target).

**`app-shell.tsx` — Req 12.2, 13.2–13.4, 15.3–15.4, 16.1, 19.1–19.3, 20.4:**

- Add `<SkipToContent />` as first child (Req 12.2).
- Replace `"☰"` with `<Menu />` Lucide icon (Req 16.1 / 19.1).
- Add `<PageProgress />` component for route-change progress bar (Req 13.2–13.3).
- Add `<OfflineBanner />` component using `navigator.onLine` + event listeners (Req 15.3–15.4).
- Add `⌘K` hint badge in the top area: `<Badge variant="outline" className="text-[10px]">⌘K</Badge>` (Req 20.4).
- Update padding to `p-4 md:p-6` (16px mobile, 24px tablet+) (Req 19.3).
- Branded loading screen: replace spinner with `<Logo />` + spinner (Req 19.2).
- Wrap page content in `<Suspense>` boundaries (Req 13.4).

**`components/skip-to-content.tsx` (new) — Req 12.2:**

```tsx
export function SkipToContent() {
  return (
    <a href="#main-content"
       className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
      Skip to content
    </a>
  );
}
```

Main content areas get `id="main-content"`.

**`components/page-progress.tsx` (new) — Req 13.2–13.3:**

A thin progress bar at the top of the viewport, triggered by Next.js router events. Uses `usePathname()` changes to animate a CSS transition bar.

**`components/offline-banner.tsx` (new) — Req 15.3–15.4:**

```tsx
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[100] bg-destructive text-white text-center text-sm py-2" role="alert">
      You are offline. Some features may be unavailable.
    </div>
  );
}
```

**`hooks/use-online.ts` (new):**

```tsx
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}
```

**`footer.tsx` — Req 21.1–21.4:**

- Replace `🔥` with `<Logo size="sm" />`.
- Add version display from `package.json` version (passed as env var `NEXT_PUBLIC_APP_VERSION`).
- Add links: Documentation (`/docs`), GitLab, License (Apache 2.0).
- Changelog dot indicator: a small colored dot next to version when a new version is detected (compare `NEXT_PUBLIC_APP_VERSION` against localStorage `last-seen-version`).

### Phase 4: Page-Level Changes (Req 7, 8, 9, 10, 11, 14, 15)

**`login/page.tsx` — Req 7.1–7.3:**

- Remove the left branding panel (`hidden lg:flex lg:w-2/5 ...`).
- Center the form: `<div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">`.
- Add `<Logo size="lg" />` above the card.
- Keep all SSO buttons and credential fields unchanged.

**`page.tsx` (landing) — Req 8.1–8.3:**

Feature cards already have hover effects (`hover:-translate-y-1`, `hover:shadow-xl`, `group-hover:scale-110` on icons). Verify and enhance:
- Ensure `transition-all duration-200` for lift effect.
- Ensure icon background scales on hover (already present via `group-hover:scale-110`).
- Replace `🔥` logo with `<Logo />` in header and footer.

**`dashboard/page.tsx` — Req 9.1–9.4, 5.5:**

- Add sparkline mini-charts to `StatCard` for "Total Emails" and "Active Inboxes".
- New `<Sparkline data={number[]} />` component: a tiny `<AreaChart>` from Recharts (already lazy-loaded), 60×24px, no axes/labels/tooltips, primary color fill.
- Pass 7-day trend data from `chartWeek` query to the stat cards.
- Show `<Skeleton className="h-6 w-16" />` while loading.
- Apply consistent gradient header to all gradient-topped cards (Req 5.5): `bg-gradient-to-r from-primary/80 to-primary/20`.

**Table alternating rows — Req 10:**

Add a utility class in `globals.css`:

```css
.table-striped tbody tr:nth-child(even) {
  @apply bg-muted/30;
}
```

Apply to data tables across list pages.

**Micro-interactions — Req 11:**

- Card hover: already present on stat cards. Add `transition-all duration-150 hover:shadow-md hover:-translate-y-0.5` to remaining clickable cards.
- Page fade-in: add `animate-in fade-in duration-200` to main content wrapper in `app-shell.tsx`.
- Toast severity icons (Req 11.3–11.6): Configure Sonner's `<Toaster />` with custom icons:

```tsx
import { CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";

<Toaster
  icons={{
    success: <CheckCircle className="h-4 w-4 text-emerald-500" />,
    error: <AlertCircle className="h-4 w-4 text-red-500" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    info: <Info className="h-4 w-4 text-blue-500" />,
  }}
/>
```

**Accessibility — Req 12.1, 12.3, 12.4:**

- Focus ring: update `globals.css` base layer:
  ```css
  *:focus-visible {
    @apply outline-2 outline-offset-[3px] outline-primary;
  }
  ```
- Toast `aria-live`: Sonner already uses `aria-live="polite"` by default. Verify.
- Status icons alongside color: where domain verification or inbox status uses color alone, add a Lucide icon (e.g., `CheckCircle` for verified, `XCircle` for failed, `Clock` for pending).

**Empty states — Req 15.1–15.2:**

- The project already has `<EmptyState>` and `<ErrorState>` components. Enhance `EmptyState` to accept an `illustration` prop (SVG) alongside the existing `icon` prop.
- Add simple SVG illustrations for key content types (inboxes, domains, teams, etc.) — minimal line-art style.
- `ErrorState` already has retry. Ensure error messages include context (e.g., "Failed to load inboxes").

**Data display — Req 14.5:**

Add result count to paginated list headers: `<span className="text-sm text-muted-foreground">{total} results</span>`.

### Phase 5: Mobile, Notifications, Forms (Req 16, 22, 23)

**Mobile card tables — Req 16.2:**

Create a `<ResponsiveTable>` wrapper that renders as a standard `<table>` on `md+` and as stacked cards on mobile. Use `@media (max-width: 767px)` or Tailwind `md:hidden` / `hidden md:table` pattern.

**Pull-to-refresh — Req 16.3:**

Add a simple pull-to-refresh hook for touch devices on list pages. Use `touchstart`/`touchmove`/`touchend` events to detect a downward pull gesture at scroll position 0, then call `refetch()`.

**Notification center — Req 22.1–22.3:**

- Responsive width: `className="w-[calc(100vw-2rem)] sm:w-96"` on `PopoverContent`.
- Browser notifications: request permission on first open, then use `new Notification()` API in the WebSocket `onmessage` handler.
- Notification grouping: group notifications by type within a 5-minute window. Show expandable header with count.

**Form UX — Req 23.1–23.5:**

- Sticky save button: wrap form submit buttons in `<div className="sticky bottom-0 bg-background/95 backdrop-blur border-t p-4">`.
- Unsaved changes warning: new `useUnsavedChanges(isDirty: boolean)` hook using `beforeunload` event + Next.js router interception.
- Settings autosave: add a 2-second debounced save with `useEffect` + `setTimeout`. Show "Saved" indicator via a small inline badge.
- Password visibility toggle: already implemented on login. Ensure same pattern on register and reset-password pages.

### Phase 6: Branding, Performance, Data Freshness (Req 17, 18, 24)

**Branding — Req 17:**

- Create `public/favicon.svg`: a simple "B" lettermark in primary color.
- Create `public/icon-192.png`: 192×192 PNG version.
- Create `public/manifest.json`:
  ```json
  {
    "name": "BurnerByte",
    "short_name": "BurnerByte",
    "icons": [{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" }],
    "theme_color": "#4f46e5",
    "background_color": "#fafaf8",
    "display": "standalone"
  }
  ```
- Dynamic page titles: use Next.js `metadata` export per page or a `useEffect` setting `document.title` in client components.
- Open Graph tags on landing page: add `og:title`, `og:description`, `og:image`, `og:url` to root layout metadata.

**Performance — Req 18:**

- Recharts lazy-loading: already implemented with `next/dynamic`. Maintain.
- Avatar images: replace `<img>` tags with `<Image>` from `next/image` where avatar/logo URLs are rendered (sidebar org logo, profile avatars).
- TanStack Query stale times: configure in the query client or per-query:
  - Notification counts: `staleTime: 60_000` (60s)
  - Org settings: `staleTime: 300_000` (5min)
  - Inbox lists: `staleTime: 30_000` (30s)

**Data freshness — Req 24:**

- `<LastUpdated dataUpdatedAt={number} />` component showing "Last updated: 3m ago" using `dataUpdatedAt` from TanStack Query.
- Dashboard auto-refresh toggle: a `<Switch>` in the dashboard header that sets `refetchInterval` on the analytics query (default: 30s when enabled).
- Real-time dashboard stats via WebSocket: extend the existing notification WebSocket to also push stat updates, or add a separate admin stats channel.

## Data Models

No new data models are required. All changes are frontend-only. The existing API responses and TypeScript types (`AnalyticsStats`, `Inbox`, `Notification`, etc.) remain unchanged.

The only new client-side state:
- `localStorage["sidebar-collapsed"]` — already exists
- `localStorage["last-seen-version"]` — new, for changelog dot indicator
- `localStorage["auto-refresh-enabled"]` — new, for dashboard auto-refresh preference

## Error Handling

| Scenario | Handling |
|----------|----------|
| Font loading failure | Browser falls back to system sans-serif/monospace. No JS error. |
| Offline detection | `OfflineBanner` shows non-dismissible banner. Auto-hides on reconnect. |
| API errors on pages | Existing `<ErrorState>` with retry button. Enhanced with contextual messages. |
| WebSocket disconnect | Existing reconnect logic (5s backoff). No change needed. |
| Browser notification permission denied | Gracefully degrade — no browser notifications, in-app notifications still work. |
| Pull-to-refresh on non-touch | Hook is a no-op on non-touch devices. |
| Autosave failure | Show error toast, keep form dirty so user can retry manually. |

## Testing Strategy

### Why Property-Based Testing Does Not Apply

This feature is a UI/UX overhaul consisting entirely of:
- CSS token changes (colors, fonts, radii)
- Component styling modifications (shadows, sizes, hover effects)
- Layout restructuring (login page, sidebar, footer)
- Animation/transition additions
- Icon replacements
- Branding asset creation

These are visual/rendering changes with no pure-function logic, no serialization, no data transformation, and no algorithmic behavior. PBT requires universal properties over varying inputs — there are no meaningful "for all X, property P(X) holds" statements for CSS changes or icon swaps.

### Recommended Testing Approach

**Visual verification (primary):**
- Manual review of each phase against requirements
- Browser DevTools responsive mode for mobile breakpoints
- Keyboard navigation testing for accessibility (Req 12)

**Example-based unit tests:**
- `Logo` component renders correct text for `collapsed` and `size` props
- `RelativeTime` component formats timestamps correctly for known inputs (e.g., 30s ago, 5m ago, 2h ago, 1d ago)
- `CopyableId` truncates UUID correctly and copies full value on click
- `Badge` renders correct classes for `success`, `warning`, `info` variants
- `useOnline` hook returns correct state on online/offline events
- `useUnsavedChanges` hook fires `beforeunload` when dirty

**Integration tests:**
- `SkipToContent` link is focusable and navigates to `#main-content`
- `OfflineBanner` appears when offline, disappears when online
- `CommandPalette` shows icons and grouped sections
- `ShortcutHelp` displays shortcuts organized by category
- Toast icons render for success/error/warning/info variants

**Accessibility checks:**
- All interactive elements have visible focus indicators (3px offset, primary color)
- `aria-live` region on toast container
- `aria-label` on icon-only buttons
- Color-only status indicators have accompanying icons

**Build verification:**
- `next build` succeeds with no TypeScript errors
- No unused imports or missing dependencies
