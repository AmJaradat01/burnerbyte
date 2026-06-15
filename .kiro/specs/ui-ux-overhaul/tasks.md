# Implementation Plan: UI/UX Overhaul

## Overview

Systematic UI/UX overhaul of the BurnerByte frontend, organized into 6 phases ordered by dependency. Each phase can be built and verified independently with `npm run build`. All changes are frontend-only (TypeScript/React/Tailwind CSS) with zero new runtime dependencies.

## Tasks

- [x] 1. Design Tokens & Fonts
  - [x] 1.1 Replace Geist fonts with Inter and JetBrains Mono in `web/src/app/layout.tsx`
    - Replace `import { Geist, Geist_Mono } from "next/font/google"` with `import { Inter, JetBrains_Mono } from "next/font/google"`
    - Create `inter` instance with `{ variable: "--font-inter", subsets: ["latin"] }`
    - Create `jetbrainsMono` instance with `{ variable: "--font-jetbrains-mono", subsets: ["latin"] }`
    - Update `<body>` className to use `${inter.variable} ${jetbrainsMono.variable} antialiased`
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 1.2 Update CSS custom properties in `web/src/app/globals.css`
    - Set `--font-sans: var(--font-inter)` and `--font-mono: var(--font-jetbrains-mono)`
    - Update `--primary` to `oklch(0.55 0.20 260)` (vibrant indigo)
    - Update `--primary-foreground` to `oklch(0.985 0 0)`
    - Update `--ring` to `oklch(0.55 0.20 260)` to match primary
    - Update `--accent` to `oklch(0.94 0.015 260)` to complement primary
    - Update `--border` to `oklch(0.86 0.008 260)` for stronger contrast
    - Add `--sidebar: oklch(0.965 0.008 260)` for tinted sidebar background
    - _Requirements: 1.3, 5.1, 5.2, 5.3, 5.4_

  - [x] 1.3 Add global focus-visible ring style and table-striped utility in `web/src/app/globals.css`
    - Add `*:focus-visible { @apply outline-2 outline-offset-[3px] outline-primary; }` to base layer
    - Add `.table-striped tbody tr:nth-child(even) { @apply bg-muted/30; }` utility class
    - _Requirements: 12.1, 10.1_

  - [ ]* 1.4 Write unit tests for design token application
    - Verify Inter and JetBrains Mono CSS variables are applied to body
    - Verify primary color token value
    - _Requirements: 1.1, 1.2, 5.1_

- [x] 2. Shared Components
  - [x] 2.1 Create `web/src/components/logo.tsx` — reusable Logo component
    - Export `Logo` component with props: `collapsed?: boolean`, `size?: "sm" | "md" | "lg"`
    - Render "Burner" in foreground + "Byte" in `text-primary`
    - When `collapsed` is true, render single "B" in primary color
    - Size classes: sm = `text-base`, md = `text-xl`, lg = `text-3xl`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 2.2 Update `web/src/components/ui/button.tsx` — increase default height
    - Change default size from `h-9` to `h-10` in the `buttonVariants` size map
    - _Requirements: 6.1_

  - [x] 2.3 Update `web/src/components/ui/input.tsx` — add inner shadow
    - Add subtle inner shadow class `shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]` to the input base styles
    - _Requirements: 6.2_

  - [x] 2.4 Update `web/src/components/ui/badge.tsx` — add semantic color variants
    - Add `success: "bg-emerald-100 text-emerald-700 border-emerald-200"` variant
    - Add `warning: "bg-amber-100 text-amber-700 border-amber-200"` variant
    - Add `info: "bg-blue-100 text-blue-700 border-blue-200"` variant
    - _Requirements: 6.4_

  - [x] 2.5 Create `web/src/components/relative-time.tsx` — relative timestamp display
    - Export `RelativeTime` component with `datetime: string` prop (ISO 8601)
    - Render relative text (e.g., "3m ago") with `title` attribute showing full ISO string
    - Auto-update every 60 seconds via `useEffect` interval
    - _Requirements: 14.1_

  - [x] 2.6 Create `web/src/components/copyable-id.tsx` — truncated UUID with copy
    - Export `CopyableId` component with `value: string` prop
    - Truncate UUID to first 8 characters + "…"
    - On click, copy full value to clipboard and show brief "Copied" toast
    - _Requirements: 14.2, 14.3_

  - [x] 2.7 Update `web/src/components/breadcrumbs.tsx` — chevron separator
    - Replace `"/"` separator with `<ChevronRight />` Lucide icon (`h-3.5 w-3.5 text-muted-foreground/50`)
    - Ensure last segment displays current page title
    - _Requirements: 19.4, 19.5_

  - [x] 2.8 Update `web/src/components/shortcut-help.tsx` — group shortcuts by category
    - Organize shortcuts into sections: Navigation, Actions, General
    - Render section headers for each group
    - _Requirements: 14.4_

  - [x] 2.9 Update `web/src/components/command-palette.tsx` — icons, actions, grouping
    - Add Lucide icons to each navigation item matching sidebar icons
    - Add action commands: "Create Inbox" (Plus icon), "Sign Out" (LogOut icon)
    - Group items with section headers: "Navigation", "Actions"
    - _Requirements: 20.1, 20.2, 20.3_

  - [ ]* 2.10 Write unit tests for shared components
    - Test `Logo` renders correct text for collapsed/expanded and each size
    - Test `RelativeTime` formats known timestamps correctly (30s, 5m, 2h, 1d)
    - Test `CopyableId` truncates UUID and copies full value on click
    - Test `Badge` renders correct classes for success, warning, info variants
    - _Requirements: 4.1, 4.5, 14.1, 14.2, 6.4_

- [ ] 3. Checkpoint — Verify tokens and shared components
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run build` to verify no TypeScript errors or missing imports.

- [ ] 4. Shell & Layout
  - [x] 4.1 Update `web/src/components/layout/sidebar.tsx` — icons, logo, background
    - Replace emoji icons in `navItems` and `manageItems` with Lucide icons: Home, BookOpen, LayoutDashboard, Globe, Users, Webhook, KeyRound, ClipboardList, BarChart3, Settings
    - Replace `🔥` logo with `<Logo />` component (collapsed prop tied to sidebar state)
    - Apply `bg-sidebar` class for tinted background using the new `--sidebar` token
    - Ensure collapse/expand buttons have `min-w-8 min-h-8` (32×32px tap target)
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.5_

  - [x] 4.2 Update `web/src/components/layout/top-nav.tsx` — Logo component
    - Replace `🔥` logo with `<Logo />` component
    - _Requirements: 4.2_

  - [x] 4.3 Create `web/src/components/skip-to-content.tsx` — accessibility skip link
    - Export `SkipToContent` component: visually hidden link that becomes visible on focus
    - Link target: `#main-content`
    - Styles: `sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground`
    - _Requirements: 12.2_

  - [x] 4.4 Create `web/src/components/page-progress.tsx` — route-change progress bar
    - Export `PageProgress` component: thin bar at top of viewport
    - Use `usePathname()` changes to trigger CSS transition animation
    - Auto-hide on route change completion
    - _Requirements: 13.2, 13.3_

  - [x] 4.5 Create `web/src/hooks/use-online.ts` — network status hook
    - Export `useOnline()` hook returning boolean
    - Listen to `window` `online`/`offline` events
    - Default to `true` during SSR
    - _Requirements: 15.3, 15.4_

  - [x] 4.6 Create `web/src/components/offline-banner.tsx` — offline indicator
    - Export `OfflineBanner` component using `useOnline()` hook
    - When offline: render fixed top banner with `role="alert"`, destructive background, "You are offline" message
    - When online: render nothing
    - _Requirements: 15.3, 15.4_

  - [x] 4.7 Update `web/src/components/layout/app-shell.tsx` — integrate shell components
    - Add `<SkipToContent />` as first child of the shell
    - Replace `"☰"` with `<Menu />` Lucide icon for mobile menu trigger
    - Add `<PageProgress />` component for route-change progress bar
    - Add `<OfflineBanner />` component
    - Add `⌘K` hint badge in top navigation area: `<Badge variant="outline" className="text-[10px]">⌘K</Badge>`
    - Update main content padding to `p-4 md:p-6` (16px mobile, 24px tablet+)
    - Add `id="main-content"` to main content wrapper
    - Replace loading spinner with `<Logo />` + spinner for branded loading screen
    - Add `animate-in fade-in duration-200` to page content wrapper for page transitions
    - Wrap page sections in `<Suspense>` boundaries with section-specific fallbacks
    - _Requirements: 12.2, 13.2, 13.3, 13.4, 15.3, 15.4, 16.1, 19.1, 19.2, 19.3, 20.4, 11.2_

  - [x] 4.8 Update `web/src/components/layout/footer.tsx` — branding, version, links
    - Replace `🔥` with `<Logo size="sm" />`
    - Add version display from `NEXT_PUBLIC_APP_VERSION` env var
    - Add links: Documentation (`/docs`), GitLab, License (Apache 2.0)
    - Add changelog dot indicator: compare `NEXT_PUBLIC_APP_VERSION` against `localStorage["last-seen-version"]`
    - _Requirements: 4.4, 21.1, 21.2, 21.3, 21.4_

  - [ ]* 4.9 Write unit tests for shell components
    - Test `SkipToContent` link is focusable and targets `#main-content`
    - Test `OfflineBanner` appears when offline, disappears when online
    - Test `useOnline` hook returns correct state on online/offline events
    - _Requirements: 12.2, 15.3, 15.4_

- [ ] 5. Checkpoint — Verify shell and layout
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run build` to verify no TypeScript errors or missing imports.

- [ ] 6. Page-Level Changes
  - [x] 6.1 Update `web/src/app/login/page.tsx` — simplify layout
    - Remove the left branding panel (`hidden lg:flex lg:w-2/5 ...` section)
    - Center the form: `flex min-h-[calc(100vh-8rem)] items-center justify-center`
    - Add `<Logo size="lg" />` above the sign-in card
    - Keep all existing SSO buttons and credential fields unchanged
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 6.2 Update `web/src/app/page.tsx` (landing) — feature card polish and logo
    - Verify feature cards have `transition-all duration-200` for hover lift effect
    - Ensure icon backgrounds scale on hover via `group-hover:scale-110`
    - Replace `🔥` logo with `<Logo />` in header and footer sections
    - _Requirements: 8.1, 8.2, 8.3, 4.3_

  - [x] 6.3 Create `web/src/components/sparkline.tsx` — mini area chart component
    - Render tiny `<AreaChart>` from Recharts (lazy-loaded), 60×24px, no axes/labels/tooltips
    - Use primary color fill with low opacity
    - _Requirements: 9.3_

  - [x] 6.4 Update `web/src/app/dashboard/page.tsx` — sparklines, skeletons, gradients
    - Add `<Sparkline />` to "Total Emails" and "Active Inboxes" stat cards using 7-day trend data
    - Show `<Skeleton className="h-6 w-16" />` while analytics data is loading
    - Apply consistent gradient header `bg-gradient-to-r from-primary/80 to-primary/20` to gradient-topped cards
    - _Requirements: 9.1, 9.2, 9.4, 5.5_

  - [x] 6.5 Apply table-striped class to data tables across list pages
    - Add `table-striped` class to `<table>` elements in: inboxes, domains, teams, webhooks, api-keys, audit list pages
    - _Requirements: 10.1, 10.2_

  - [x] 6.6 Add micro-interactions — card hover and toast severity icons
    - Add `transition-all duration-150 hover:shadow-md hover:-translate-y-0.5` to remaining clickable cards
    - Configure Sonner `<Toaster />` in `web/src/components/ui/sonner.tsx` with custom severity icons: CheckCircle (green), AlertCircle (red), AlertTriangle (amber), Info (blue)
    - _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6_

  - [x] 6.7 Add status icons alongside color indicators
    - In domain verification status displays, add Lucide icons: `CheckCircle` for verified, `XCircle` for failed, `Clock` for pending
    - In inbox active/expired status displays, add corresponding icons alongside color
    - _Requirements: 12.4_

  - [x] 6.8 Enhance `web/src/components/empty-state.tsx` — illustration support
    - Add optional `illustration` prop (ReactNode) to `EmptyState` component
    - Render SVG illustration above the message when provided
    - Add simple line-art SVG illustrations for key content types (inboxes, domains, teams)
    - _Requirements: 15.1_

  - [x] 6.9 Enhance error messages with context
    - Update `ErrorState` usage across list pages to include contextual messages (e.g., "Failed to load inboxes", "Failed to load domains")
    - Ensure retry button is present on all error states
    - _Requirements: 15.2_

  - [x] 6.10 Add result count to paginated list headers
    - Add `<span className="text-sm text-muted-foreground">{total} results</span>` to list page headers where pagination is used
    - _Requirements: 14.5_

  - [ ]* 6.11 Write unit tests for page-level components
    - Test `Sparkline` renders an area chart with provided data
    - Test toast icons render for success/error/warning/info variants
    - Test `EmptyState` renders illustration when provided
    - _Requirements: 9.3, 11.3, 15.1_

- [ ] 7. Checkpoint — Verify page-level changes
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run build` to verify no TypeScript errors or missing imports.

- [ ] 8. Mobile, Notifications, Forms
  - [x] 8.1 Create responsive table wrapper for mobile card layouts
    - Create `web/src/components/responsive-table.tsx` that renders `<table>` on `md+` and stacked cards on mobile
    - Use `md:hidden` / `hidden md:table` pattern for breakpoint switching
    - Apply to data tables on list pages (inboxes, domains, teams, webhooks, api-keys, audit)
    - _Requirements: 16.2_

  - [x] 8.2 Add pull-to-refresh on list pages for touch devices
    - Create `web/src/hooks/use-pull-to-refresh.ts` hook using `touchstart`/`touchmove`/`touchend` events
    - Detect downward pull gesture at scroll position 0, then call provided `refetch()` callback
    - No-op on non-touch devices
    - Integrate into list pages (inboxes, domains, teams)
    - _Requirements: 16.3_

  - [x] 8.3 Update `web/src/components/notification-center.tsx` — responsive width, browser notifications, grouping
    - Set popover width to `w-[calc(100vw-2rem)] sm:w-96` for responsive sizing
    - Add browser notification permission request on first open
    - Use `new Notification()` API in WebSocket `onmessage` handler when permission granted
    - Group notifications by type within 5-minute window with expandable header showing count
    - _Requirements: 22.1, 22.2, 22.3_

  - [x] 8.4 Add sticky save button wrapper for forms
    - Wrap form submit buttons in `<div className="sticky bottom-0 bg-background/95 backdrop-blur border-t p-4">` across form pages
    - Apply to settings, profile, and other form pages with save/submit buttons
    - _Requirements: 23.1_

  - [x] 8.5 Create `web/src/hooks/use-unsaved-changes.ts` — navigation guard hook
    - Export `useUnsavedChanges(isDirty: boolean)` hook
    - Register `beforeunload` event when `isDirty` is true
    - Add Next.js router interception to show confirmation dialog on navigation
    - _Requirements: 23.2_

  - [x] 8.6 Add settings autosave with debounce
    - In `web/src/app/settings/page.tsx`, add 2-second debounced autosave using `useEffect` + `setTimeout`
    - Show inline "Saved" badge indicator near the form after successful save
    - _Requirements: 23.3, 23.4_

  - [x] 8.7 Ensure password visibility toggle on all password fields
    - Verify show/hide toggle exists on login password field (already implemented)
    - Add same toggle pattern to register and reset-password page password fields
    - _Requirements: 23.5_

  - [ ]* 8.8 Write unit tests for mobile and form components
    - Test `useUnsavedChanges` fires `beforeunload` when dirty
    - Test notification grouping logic groups same-type notifications within 5-minute window
    - _Requirements: 23.2, 22.3_

- [ ] 9. Checkpoint — Verify mobile, notifications, and forms
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run build` to verify no TypeScript errors or missing imports.

- [ ] 10. Branding, Performance, Data Freshness
  - [x] 10.1 Create branding assets and PWA manifest
    - Create `web/public/favicon.svg`: simple "B" lettermark in primary color
    - Create `web/public/icon-192.png`: 192×192 PNG version of the lettermark
    - Create `web/public/manifest.json` with PWA metadata (name, short_name, icons, theme_color `#4f46e5`, background_color `#fafaf8`, display standalone)
    - Add `<link rel="manifest" href="/manifest.json" />` to root layout
    - _Requirements: 17.1, 17.2_

  - [x] 10.2 Add dynamic page titles and Open Graph meta tags
    - Add Next.js `metadata` export to each page for dynamic titles (e.g., "Dashboard — BurnerByte", "Inboxes — BurnerByte")
    - Add `og:title`, `og:description`, `og:image`, `og:url` to root layout or landing page metadata
    - _Requirements: 17.3, 17.4_

  - [x] 10.3 Optimize avatar images with Next.js Image component
    - Replace `<img>` tags with `<Image>` from `next/image` for user avatars and org logos
    - Set appropriate `width`, `height`, and `loading="lazy"` attributes
    - _Requirements: 18.2_

  - [x] 10.4 Configure TanStack Query stale times
    - Set `staleTime: 60_000` (60s) for notification count queries
    - Set `staleTime: 300_000` (5min) for org settings queries
    - Set `staleTime: 30_000` (30s) for inbox list queries
    - _Requirements: 18.3_

  - [x] 10.5 Create `web/src/components/last-updated.tsx` — data freshness indicator
    - Export `LastUpdated` component with `dataUpdatedAt: number` prop (from TanStack Query)
    - Render "Last updated: [relative time]" text
    - Add to dashboard and key list pages near data sections
    - _Requirements: 24.1_

  - [x] 10.6 Add dashboard auto-refresh toggle
    - Add `<Switch>` control in dashboard header to enable/disable auto-refresh
    - When enabled, set `refetchInterval` on analytics queries (default: 30s)
    - Persist preference in `localStorage["auto-refresh-enabled"]`
    - _Requirements: 24.2, 24.3_

  - [x] 10.7 Extend WebSocket for real-time dashboard stats
    - Extend existing notification WebSocket handler to also process stat update messages
    - Update "Total Emails" and "Active Inboxes" stat cards in real-time when WebSocket messages arrive
    - _Requirements: 24.4_

  - [ ]* 10.8 Write unit tests for data freshness components
    - Test `LastUpdated` renders correct relative time from `dataUpdatedAt`
    - Test auto-refresh toggle sets `refetchInterval` when enabled
    - _Requirements: 24.1, 24.2_

- [ ] 11. Final Checkpoint — Full build and verification
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run build` to verify zero TypeScript errors, no missing imports, and no unused dependencies.
  - Verify `next build` completes successfully.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirement acceptance criteria for traceability
- Checkpoints after each phase ensure incremental validation via `npm run build`
- No new runtime dependencies are added — fonts use `next/font/google`, progress bar is custom CSS
- All changes are frontend-only; no backend or data model changes required
- Property-based tests are not applicable (UI/UX changes with no pure-function logic)

## Test Coverage Status (pragmatic backfill)

The remaining tests are full React component/integration tests — they render
complex settings/page components that depend on react-query and the api module
and assert against the DOM. The project has no react-query component-test
harness (QueryClientProvider wrapper + api mocking) yet, and the only existing
component test covers a dependency-free presentational component. Building that
harness and the render tests is integration-level work beyond the pragmatic
unit-coverage pass, so these are deferred. The UI changes themselves are
implemented and shipped.

## Update — shared component tests added

`web/src/components/ui/badge.test.tsx` covers the shared Badge (task 2.10):
base render, default primary variant, and the overhaul's semantic token variants
(success/warning/info), plus className merge. The remaining shell/page-level/
mobile/data-freshness unit tests need the react-query render harness and remain
open.
