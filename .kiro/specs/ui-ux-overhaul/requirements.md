# Requirements Document

## Introduction

This document specifies the requirements for a systematic UI/UX overhaul of the BurnerByte frontend application. The overhaul covers 66 enhancement items across 19 categories, spanning typography, navigation, color system, component polish, page-level improvements, micro-interactions, accessibility, loading states, data display, empty/error states, mobile experience, branding, performance, layout, command palette, footer, notifications, form UX, and data freshness. The application is built with Next.js 14, React 18, TypeScript, shadcn/ui, Tailwind CSS v4, TanStack Query, Recharts, Lucide React, Sonner, and next-intl. The application operates in light mode only.

## Glossary

- **App_Shell**: The root layout component (`app-shell.tsx`) that manages authentication routing, sidebar/top-nav rendering, and page chrome for all authenticated and unauthenticated views.
- **Sidebar**: The left-hand navigation panel (`sidebar.tsx`) rendered for org-admin users, containing nav links, org card, and user section.
- **Top_Nav**: The horizontal navigation bar (`top-nav.tsx`) rendered for regular (non-admin) authenticated users.
- **Command_Palette**: The `⌘K`-triggered dialog (`command-palette.tsx`) for quick page navigation and action execution.
- **Breadcrumbs**: The path-based navigation trail (`breadcrumbs.tsx`) displayed above page content.
- **Footer**: The bottom bar (`footer.tsx`) displaying branding and links.
- **Notification_Center**: The bell-icon popover (`notification-center.tsx`) displaying real-time notifications via WebSocket.
- **Shortcut_Help**: The keyboard shortcut reference dialog (`shortcut-help.tsx`).
- **Theme_System**: The CSS custom property definitions in `globals.css` that control colors, radii, and font variables.
- **Skeleton**: A placeholder loading component from shadcn/ui used to indicate content is being fetched.
- **Toast**: A transient notification message rendered by Sonner at the bottom of the viewport.
- **Badge**: An inline label component (`badge.tsx`) used for status indicators, counts, and tags.
- **Input**: The text input component (`input.tsx`) used across all forms.
- **Button**: The button component (`button.tsx`) with variant and size props.
- **Dashboard**: The admin analytics overview page (`dashboard/page.tsx`) displaying stats, charts, and activity.
- **Landing_Page**: The public marketing page (`page.tsx`) shown to unauthenticated visitors.
- **Login_Page**: The authentication page (`login/page.tsx`) with credential and SSO sign-in flows.
- **Stat_Card**: A dashboard metric card displaying an icon, label, value, and optional footer link.
- **PWA**: Progressive Web App — a set of web manifest and icon assets enabling install-to-homescreen behavior.
- **Open_Graph**: The `og:` meta tag protocol used by social platforms to generate link previews.
- **Sparkline**: A small, inline area or line chart rendered without axes, used to show trends at a glance.
- **Stale_Time**: A TanStack Query configuration value controlling how long cached data is considered fresh before re-fetching.

## Requirements

### Requirement 1: Font Replacement

**User Story:** As a developer, I want the application to use Inter and JetBrains Mono fonts, so that the typography is more readable and visually consistent.

#### Acceptance Criteria

1. WHEN the application loads, THE Theme_System SHALL render body text using the Inter font family instead of Geist Sans.
2. WHEN the application loads, THE Theme_System SHALL render monospace text using the JetBrains Mono font family instead of Geist Mono.
3. THE Theme_System SHALL define `--font-sans` as the Inter CSS variable and `--font-mono` as the JetBrains Mono CSS variable in `globals.css`.
4. WHEN a page renders, THE App_Shell SHALL apply the Inter font variable class and JetBrains Mono font variable class to the `<body>` element.

### Requirement 2: Navigation Icon Replacement

**User Story:** As a user, I want sidebar navigation items to use Lucide icons instead of emoji, so that the interface looks professional and scales cleanly.

#### Acceptance Criteria

1. THE Sidebar SHALL render a Lucide React icon component for each navigation item instead of an emoji character.
2. THE Sidebar SHALL map each navigation section to a semantically appropriate Lucide icon (e.g., `LayoutDashboard` for Dashboard, `Globe` for Domains, `Users` for Teams, `Webhook` for Webhooks, `KeyRound` for API Keys, `ClipboardList` for Audit Log, `BarChart3` for Analytics, `Settings` for Settings, `Home` for Home, `BookOpen` for Docs).
3. WHEN the Sidebar is in collapsed mode, THE Sidebar SHALL display only the Lucide icon centered in the nav item.

### Requirement 3: Sidebar Visual Polish

**User Story:** As a user, I want the sidebar to have a subtle tinted background and improved toggle controls, so that it feels more refined.

#### Acceptance Criteria

1. THE Sidebar SHALL render with a subtle tinted background color distinct from the main content area background.
2. THE Sidebar collapse toggle button SHALL have a minimum tap target of 32×32 pixels.
3. THE Sidebar expand toggle button SHALL have a minimum tap target of 32×32 pixels.

### Requirement 4: Logo Text Mark

**User Story:** As a user, I want the logo to be a styled text mark instead of an emoji, so that the branding is more polished.

#### Acceptance Criteria

1. THE Sidebar SHALL render the BurnerByte logo as a styled text element with a colored accent instead of the 🔥 emoji.
2. THE Top_Nav SHALL render the BurnerByte logo as a styled text element with a colored accent instead of the 🔥 emoji.
3. THE Landing_Page header SHALL render the BurnerByte logo as a styled text element with a colored accent instead of the 🔥 emoji.
4. THE Footer SHALL render the BurnerByte logo as a styled text element with a colored accent instead of the 🔥 emoji.
5. WHEN the Sidebar is collapsed, THE Sidebar SHALL display a single-letter or abbreviated text mark for the logo.

### Requirement 5: Color System Upgrade

**User Story:** As a user, I want the primary color to be a vibrant blue/indigo and all accent colors to be aligned, so that the interface has a cohesive, modern palette.

#### Acceptance Criteria

1. THE Theme_System SHALL define `--primary` as a vibrant blue/indigo color in oklch color space.
2. THE Theme_System SHALL define `--ring` to match or complement the new primary color.
3. THE Theme_System SHALL define `--accent` to complement the new primary color.
4. THE Theme_System SHALL define `--border` with increased contrast compared to the current value for stronger card borders.
5. THE Dashboard SHALL apply a consistent gradient header color scheme derived from the primary color across all gradient-topped cards.

### Requirement 6: Component Polish

**User Story:** As a user, I want buttons, inputs, avatars, and badges to have refined styling, so that the component library feels cohesive and tactile.

#### Acceptance Criteria

1. THE Button SHALL have a default height of 40 pixels (h-10) instead of the current 36 pixels (h-9).
2. THE Input SHALL render with a subtle inner shadow to provide visual depth.
3. WHEN a user avatar image fails to load, THE App_Shell SHALL display a fallback containing the first letter of the user display name on a colored background with consistent sizing.
4. THE Badge SHALL support semantic color variants: `success` (green), `warning` (amber), `info` (blue), and `destructive` (red) in addition to existing variants.

### Requirement 7: Login Page Simplification

**User Story:** As a user, I want the login page to have a simpler, centered layout, so that sign-in is fast and distraction-free.

#### Acceptance Criteria

1. THE Login_Page SHALL render the sign-in form centered on the page without the left branding panel.
2. THE Login_Page SHALL display the BurnerByte text mark logo above the form.
3. THE Login_Page SHALL retain all existing SSO provider buttons and credential fields.

### Requirement 8: Landing Page Feature Card Enhancement

**User Story:** As a visitor, I want the landing page feature cards to have hover effects and visual polish, so that the product feels premium.

#### Acceptance Criteria

1. WHEN a visitor hovers over a feature card, THE Landing_Page SHALL apply a lift effect with increased shadow and a subtle border color shift.
2. THE Landing_Page feature cards SHALL display an icon with a colored background that scales on hover.
3. THE Landing_Page feature cards SHALL maintain the existing icon-to-color mapping for each feature.

### Requirement 9: Dashboard Sparkline Mini-Charts

**User Story:** As an admin, I want sparkline mini-charts on dashboard stat cards, so that I can see trends at a glance without navigating to detailed charts.

#### Acceptance Criteria

1. WHEN the Dashboard loads with analytics data, THE Stat_Card for Total Emails SHALL display a sparkline showing the 7-day email volume trend.
2. WHEN the Dashboard loads with analytics data, THE Stat_Card for Active Inboxes SHALL display a sparkline showing the 7-day inbox count trend.
3. THE Sparkline SHALL render as a small area chart without axes, labels, or tooltips, using the primary color.
4. WHILE analytics data is loading, THE Stat_Card SHALL display a Skeleton placeholder in place of the sparkline.

### Requirement 10: Table Row Alternating Backgrounds

**User Story:** As a user, I want data tables to have alternating row backgrounds, so that rows are easier to scan.

#### Acceptance Criteria

1. THE Theme_System SHALL define a utility class that applies alternating background colors to even table rows.
2. WHEN a data table renders, THE table component SHALL apply the alternating row background class to improve readability.

### Requirement 11: Micro-Interactions

**User Story:** As a user, I want refined hover effects, page transitions, and toast severity icons, so that the interface feels responsive and polished.

#### Acceptance Criteria

1. WHEN a user hovers over a clickable card, THE card SHALL apply a subtle scale and shadow transition within 150 milliseconds.
2. WHEN a page route changes, THE App_Shell SHALL apply a fade-in animation to the incoming page content with a duration of 200 milliseconds.
3. WHEN a success toast is displayed, THE Toast SHALL render a green check-circle icon alongside the message.
4. WHEN an error toast is displayed, THE Toast SHALL render a red alert-circle icon alongside the message.
5. WHEN a warning toast is displayed, THE Toast SHALL render an amber alert-triangle icon alongside the message.
6. WHEN an info toast is displayed, THE Toast SHALL render a blue info icon alongside the message.

### Requirement 12: Accessibility Enhancements

**User Story:** As a user with assistive technology, I want proper focus indicators, skip navigation, and live regions, so that the application is usable with keyboard and screen readers.

#### Acceptance Criteria

1. THE Theme_System SHALL define a custom `focus-visible` ring style using the primary color with a 3-pixel offset for all interactive elements.
2. THE App_Shell SHALL render a visually hidden "Skip to content" link as the first focusable element that becomes visible on focus and navigates to the main content area.
3. THE Toast container SHALL have an `aria-live="polite"` attribute so that screen readers announce new toast messages.
4. WHEN a status is displayed using color alone (e.g., domain verification status, inbox active/expired), THE component SHALL also display a Lucide icon alongside the color indicator.

### Requirement 13: Loading State Improvements

**User Story:** As a user, I want loading states that match the shape of the content being loaded and a progress bar during navigation, so that the interface feels fast and predictable.

#### Acceptance Criteria

1. WHEN content is loading, THE Skeleton placeholders SHALL match the approximate shape and dimensions of the content being loaded (e.g., card-shaped skeletons for card grids, row-shaped skeletons for table rows).
2. WHEN a route change begins, THE App_Shell SHALL display a thin progress bar at the top of the viewport.
3. WHEN the route change completes, THE App_Shell SHALL hide the progress bar.
4. THE App_Shell SHALL wrap each major page section in a React Suspense boundary with a section-specific fallback.

### Requirement 14: Data Display Enhancements

**User Story:** As a user, I want relative timestamps with full-date tooltips, copyable UUIDs, a keyboard shortcut cheat sheet, and result counts, so that data is easier to read and interact with.

#### Acceptance Criteria

1. WHEN a timestamp is displayed, THE component SHALL render a relative time string (e.g., "3m ago") with a tooltip showing the full ISO 8601 date and time.
2. WHEN a UUID is displayed, THE component SHALL render a truncated UUID with a copy-on-click action that copies the full UUID to the clipboard.
3. WHEN a UUID is copied, THE component SHALL display a brief "Copied" confirmation via a toast or inline indicator.
4. THE Shortcut_Help dialog SHALL display shortcuts organized by category (Navigation, Actions, General).
5. WHEN a paginated list renders, THE list header SHALL display the total result count (e.g., "42 results").

### Requirement 15: Empty and Error State Improvements

**User Story:** As a user, I want meaningful empty states with illustrations and contextual error messages, so that I understand what happened and what to do next.

#### Acceptance Criteria

1. WHEN a list page has no data, THE page SHALL display an SVG illustration relevant to the content type alongside a descriptive message and a call-to-action button.
2. WHEN an API request fails, THE error message SHALL include context about what failed (e.g., "Failed to load inboxes") and a retry button.
3. WHEN the browser loses network connectivity, THE App_Shell SHALL display a non-dismissible banner at the top of the viewport indicating offline status.
4. WHEN network connectivity is restored, THE App_Shell SHALL automatically hide the offline banner.

### Requirement 16: Mobile Experience

**User Story:** As a mobile user, I want a proper hamburger menu, card-based table layouts, and pull-to-refresh, so that the app is usable on small screens.

#### Acceptance Criteria

1. THE App_Shell mobile menu trigger SHALL render a Lucide `Menu` icon instead of the current "☰" text character.
2. WHILE the viewport width is below the `md` breakpoint (768px), THE data tables SHALL render as stacked card layouts instead of horizontal table rows.
3. WHEN a user pulls down on a list page on a touch device, THE page SHALL trigger a data refresh.

### Requirement 17: Branding Assets

**User Story:** As a user, I want proper favicon, PWA icons, dynamic page titles, and Open Graph meta tags, so that the app looks professional in browser tabs, home screens, and social shares.

#### Acceptance Criteria

1. THE application SHALL include a favicon in SVG format and a 192×192 PNG icon for PWA manifest.
2. THE application SHALL include a `manifest.json` file with PWA metadata (name, short_name, icons, theme_color, background_color).
3. WHEN a page renders, THE page SHALL set a dynamic `<title>` reflecting the current page name (e.g., "Dashboard — BurnerByte", "Inboxes — BurnerByte").
4. THE application SHALL include Open Graph meta tags (`og:title`, `og:description`, `og:image`, `og:url`) on the landing page for social media link previews.

### Requirement 18: Performance Optimizations

**User Story:** As a user, I want charts to lazy-load, avatars to use optimized images, and queries to have appropriate stale times, so that the app loads fast.

#### Acceptance Criteria

1. THE Dashboard SHALL lazy-load Recharts components using `next/dynamic` with `ssr: false` (already implemented, maintain this pattern).
2. WHEN a user avatar or org logo is rendered from a URL, THE component SHALL use the Next.js `Image` component with appropriate `width`, `height`, and `loading="lazy"` attributes.
3. THE TanStack Query configuration SHALL set `staleTime` values appropriate to data volatility: 60 seconds for notification counts, 5 minutes for org settings, and 30 seconds for inbox lists.

### Requirement 19: Layout and Shell Improvements

**User Story:** As a user, I want a branded loading screen, clean responsive padding, and breadcrumbs with chevron separators, so that the layout feels polished.

#### Acceptance Criteria

1. THE App_Shell mobile menu trigger SHALL render a Lucide `Menu` icon (same as Requirement 16.1).
2. WHILE the application is in its initial loading state, THE App_Shell SHALL display a branded loading screen with the BurnerByte text mark and a spinner.
3. THE App_Shell main content area SHALL apply consistent responsive padding: 16px on mobile, 24px on tablet and above.
4. THE Breadcrumbs SHALL use a `ChevronRight` Lucide icon as the separator between segments instead of the "/" character.
5. THE Breadcrumbs SHALL display the current page title as the last breadcrumb segment.

### Requirement 20: Command Palette Enhancements

**User Story:** As a power user, I want icons in the command palette, action commands, grouped shortcuts, and a visible ⌘K hint, so that the palette is more useful and discoverable.

#### Acceptance Criteria

1. THE Command_Palette SHALL display a Lucide icon next to each navigation item matching the icon used in the Sidebar.
2. THE Command_Palette SHALL support action commands (e.g., "Create Inbox", "Sign Out") in addition to navigation commands.
3. THE Command_Palette SHALL group items by category (Navigation, Actions) with visible section headers.
4. THE App_Shell SHALL display a persistent "⌘K" hint badge in the top navigation area to indicate the command palette shortcut.

### Requirement 21: Footer Enhancements

**User Story:** As a user, I want the footer to show the app version, useful links, and a changelog indicator, so that I know what version I am running and can find resources.

#### Acceptance Criteria

1. THE Footer SHALL display the application version number.
2. THE Footer SHALL display links to documentation, GitLab repository, and license information.
3. THE Footer for unauthenticated pages SHALL display the same links and version as the authenticated Footer.
4. WHEN a new changelog entry is available, THE Footer SHALL display a visual indicator (e.g., a dot badge) next to the version number.

### Requirement 22: Notification Enhancements

**User Story:** As a user, I want the notification popover to be responsive, support browser notifications, and group related notifications, so that notifications are manageable.

#### Acceptance Criteria

1. WHILE the viewport width is below the `sm` breakpoint (640px), THE Notification_Center popover SHALL render at full viewport width minus padding instead of the fixed 384px width.
2. WHEN a user grants browser notification permission, THE Notification_Center SHALL display a browser notification for each new real-time event received via WebSocket.
3. WHEN multiple notifications of the same type arrive within 5 minutes, THE Notification_Center SHALL group the notifications under a single expandable header showing the count.

### Requirement 23: Form UX Improvements

**User Story:** As a user, I want always-visible save buttons, unsaved changes warnings, autosave for settings, and password visibility toggles, so that form interactions are safe and convenient.

#### Acceptance Criteria

1. WHEN a form has a save/submit button, THE form SHALL render the button in a sticky footer bar that remains visible during scrolling.
2. WHEN a user has unsaved form changes and attempts to navigate away, THE App_Shell SHALL display a confirmation dialog warning about unsaved changes.
3. WHILE the user is on the Settings page, THE Settings form SHALL autosave changes after a 2-second debounce period following the last edit.
4. WHEN autosave triggers, THE Settings form SHALL display a brief "Saved" indicator near the form.
5. THE Login_Page password field SHALL include a show/hide toggle button (already implemented, maintain this pattern across all password fields).

### Requirement 24: Data Freshness Indicators

**User Story:** As a user, I want to see when data was last updated, toggle auto-refresh, and receive real-time admin stats, so that I trust the data I am viewing.

#### Acceptance Criteria

1. WHEN a data query completes, THE page SHALL display a "Last updated: [relative time]" indicator near the data.
2. THE Dashboard SHALL provide a toggle control that enables or disables automatic data refresh at a configurable interval.
3. WHEN auto-refresh is enabled, THE Dashboard SHALL re-fetch analytics data at the configured interval.
4. WHEN the admin Dashboard is open, THE Dashboard SHALL receive real-time stat updates via WebSocket for key metrics (total emails, active inboxes).
