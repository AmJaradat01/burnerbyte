# BurnerByte UI Design Standards

Project-specific design steering for all frontend work on BurnerByte.
This file synthesizes rules from the project's design skills (Impeccable, Taste Skill)
plus accessibility and Next.js architecture audit patterns into a single,
always-on reference for the agent.

---

## 1. Project Identity

- **Product:** Self-hosted open-source temporary email platform
- **Register:** Product (design SERVES the product, not IS the product)
- **Audience:** Developers, sysadmins, privacy-focused technical users
- **Tone:** Confident, technical, restrained. Not playful, not corporate.
- **Color strategy:** Restrained (tinted neutrals + one accent at 10% budget)

## 2. Stack (non-negotiable)

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16, React 19, Server Components default |
| Styling | Tailwind CSS v4 (CSS-first config via `@theme inline` in globals.css) |
| Components | shadcn/ui (new-york style), Radix UI primitives |
| State | Zustand (global), React Query (server), useState (local) |
| Font | Geist Sans (`--font-geist-sans`) + Geist Mono (`--font-geist-mono`) |
| Icons | Lucide React (project standard, do not introduce another library) |
| Animation | CSS transitions + tw-animate-css. No Motion/Framer unless explicitly requested. |
| i18n | next-intl (all user-facing strings go through `useTranslations`) |
| Forms | react-hook-form + zod validation |
| Charts | Recharts (lazy-loaded via `dynamic()`) |

### Stack rules
- Never install a package that duplicates existing functionality.
- Check `web/package.json` before importing ANY library.
- Use `@tailwindcss/postcss` (v4). No `tailwind.config.js` - tokens live in `globals.css`.
- All interactive components MUST be `'use client'` leaf islands.
- Server Components render static layout only.

## 3. Design Tokens (source of truth: `web/src/app/globals.css`)

### Color system
- OKLCH throughout. Hue axis: 265 (indigo).
- Neutrals tinted toward hue 265 at chroma 0.004-0.028.
- Primary: `oklch(0.52 0.215 264)` - confident indigo.
- Never use `#000` or `#fff`. Use `--foreground` / `--background` tokens.
- One accent color per page, locked across all sections.

### Elevation
- Shadows are tinted to `rgb(30 27 75 / ...)` - the indigo axis.
- Use the shadow scale (`shadow-2xs` through `shadow-xl`), never custom box-shadow.
- Separation via soft layered elevation, not heavy borders.

### Radius
- Base: `0.7rem`. Derived via `--radius-sm` through `--radius-4xl`.
- One radius system per page. Do not mix round buttons with square cards.

### Typography utilities
- `.text-headline` - 1.75rem/700/-0.025em (page headings)
- `.text-title` - 1.125rem/600/-0.01em (section titles)
- `.text-label` - 0.75rem/500/0.01em (small labels)
- `.tabular-nums` - for all numeric values

## 4. Layout Principles

### Spacing
- Vary spacing for rhythm. Same padding everywhere is monotony.
- Section gaps: `py-16 sm:py-20` (standard), `py-20 sm:py-28` (emphasis).
- Content containers: `max-w-6xl mx-auto px-6 sm:px-8` (landing), `max-w-5xl` (app).

### Grid
- Use CSS Grid over flexbox percentage math.
- Never `w-[calc(33%-1rem)]`. Always `grid grid-cols-1 md:grid-cols-3 gap-6`.
- Breakpoints: sm 640, md 768, lg 1024, xl 1280.

### Cards
- Use cards ONLY when elevation communicates real hierarchy.
- For data-dense surfaces (dashboard), prefer `border-t` / `divide-y` / negative space.
- No nested cards. Ever.
- No identical card grids (same-sized cards with icon + heading + text repeated).

### Viewport
- Full-height: `min-h-[100dvh]`. Never `h-screen`.
- Hero top padding max `pt-24`.
- Navigation max height 80px, single line on desktop.

## 5. Component Conventions

### Buttons
- Primary: `bg-primary text-primary-foreground hover:bg-primary/90`
- Ghost: transparent, hover reveals muted background
- Active press: `active:translate-y-px` or `active:scale-[0.98]`
- Button text MUST fit one line. Max 3 words for primary CTAs.
- Contrast check: WCAG AA minimum (4.5:1 body, 3:1 large text).

### Forms
- Label ABOVE input. Helper text optional. Error text BELOW input.
- No placeholder-as-label. Ever.
- Gap: `gap-2` for input blocks.
- All inputs, placeholders, focus rings pass WCAG AA against section background.

### Empty states
- Include an icon (from Lucide, matching the feature area).
- Title + description (max 2 sentences) + optional primary action.
- Centered, generous vertical padding (`py-16`).
- Personality through copy, not decoration.

### Loading states
- Skeleton loaders matching the final layout shape.
- Use `<Skeleton>` component, not generic spinners.
- Animate with pulse (already in shadcn skeleton).

### Error states
- Clear, inline for forms. Contextual toasts (Sonner) for transient errors.
- Always offer a retry action.
- Never show raw error codes to users.

## 6. Motion & Interaction

### Principles
- Motion is motivated: hierarchy, storytelling, feedback, or state transition.
- "It looked cool" is not a reason.
- Gate all animation on `prefers-reduced-motion: no-preference`.

### Allowed patterns
- Page transitions: `animate-in fade-in duration-200` (already in app-shell)
- Landing scroll-reveal: CSS `animation-timeline: view()` (already in globals.css)
- Hover feedback: `transition-colors duration-150` / `duration-200`
- Active press: `active:translate-y-px`
- Card hover: `hover:bg-muted/40` or `hover:border-primary/20`
- Icon hover: `group-hover:text-primary transition-colors`

### Forbidden
- No `window.addEventListener('scroll', ...)` - use CSS scroll-driven or IntersectionObserver.
- No bounce/elastic easing. Use `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo).
- No infinite animation loops except the terminal cursor blink (already defined).
- No animating layout properties (top, left, width, height). Transform + opacity only.

## 7. Accessibility (mandatory)

### Contrast
- Body text: WCAG AA (4.5:1) minimum.
- Large text (18px+): 3:1 minimum.
- Interactive elements (buttons, links, form controls): 3:1 against adjacent colors.
- Muted text (`--muted-foreground`): verify against `--background` and `--muted`.

### Keyboard
- All interactive elements reachable via Tab.
- Focus ring: `outline-2 outline-offset-[3px] outline-primary` (already in globals.css).
- Skip-to-content link (already implemented).
- Keyboard shortcuts documented in ShortcutHelp dialog.

### Semantic HTML
- Headings in order (h1 > h2 > h3). One h1 per page.
- Lists use `<ul>/<ol>/<dl>`. Not divs with visual bullets.
- Tables use `<table>` with proper `<thead>`, `<th scope>`.
- Images: meaningful `alt` text or `aria-hidden="true"` for decorative.
- Icon buttons: `aria-label` always present.
- Loading indicators: `role="status"` + `<span className="sr-only">`.

### Forms
- Every input has an associated `<label>` (or `aria-label`).
- Error messages linked via `aria-describedby`.
- Required fields marked with `aria-required="true"`.
- Form groups use `<fieldset>` + `<legend>` when appropriate.

### ARIA
- Use native HTML elements first. ARIA is a supplement, not a replacement.
- `aria-live="polite"` for dynamic content updates (notifications, live data).
- `aria-expanded` on toggles (sidebar collapse, dropdowns).
- `role="navigation"` with `aria-label` for nav landmarks.

## 8. Anti-Patterns (absolute bans)

### Visual
- No side-stripe borders (border-left/right > 1px as accent).
- No gradient text (`background-clip: text` + gradient).
- No glassmorphism as default.
- No hero-metric template (big number + small label + gradient).
- No identical card grids.
- No modal as first thought (exhaust inline alternatives).
- No neon/outer glows.
- No pure black/white.

### Typography
- No Inter (we use Geist).
- No serif fonts unless brand-justified.
- No em-dashes anywhere. Use commas, colons, semicolons, periods, or hyphens.
- Body line length capped at 65-75ch (`max-w-[65ch]` or `max-w-xl`).

### Layout
- No centered hero when variance is high (use split/asymmetric).
- No 3-column equal feature cards.
- No zigzag alternation beyond 2 consecutive sections.
- No section-number eyebrows ("01 / Capabilities").
- Max 1 eyebrow per 3 sections.

### Content
- No generic names ("John Doe", "Jane Smith").
- No startup-slop brand names ("Acme", "Nexus").
- No filler verbs ("Elevate", "Seamless", "Unleash").
- No fake-precise numbers without real data backing.
- No version labels in hero ("BETA", "V0.6").
- No scroll cues ("Scroll to explore").
- No decorative status dots unless conveying real semantic state.

## 9. Performance

### Core Web Vitals targets
- LCP < 2.5s. Hero images: `priority` prop or preload.
- INP < 200ms. Heavy work off main thread.
- CLS < 0.1. Reserve space for images, fonts, embeds.

### Bundle
- Lazy-load below-fold components with `dynamic()` + `{ ssr: false }` for client-only.
- Charts (Recharts) always lazy-loaded.
- Images: use `next/image` with proper `width`/`height` or `fill`.

### DOM
- No grain/noise filters on scrolling containers.
- Z-index: use sparingly, document the scale.
- Avoid re-renders: `useMotionValue` for continuous values, not `useState`.

## 10. File Organization

```
web/src/
  app/            # Route segments (page.tsx, layout.tsx, loading.tsx, error.tsx)
  components/
    ui/           # shadcn/ui primitives (do not modify core behavior)
    layout/       # Shell, sidebar, nav, footer
    landing/      # Landing page specific components
    inbox/        # Inbox feature components
    settings/     # Settings feature components
    *.tsx         # Shared components (empty-state, error-state, etc.)
  hooks/          # Custom React hooks
  stores/         # Zustand stores
  lib/            # Utilities, API client, helpers
  types/          # TypeScript type definitions
  i18n/           # Internationalization config
```

### Naming
- Components: PascalCase (`EmptyState.tsx` exports `EmptyState`)
- Hooks: camelCase with `use` prefix (`use-keyboard-shortcuts.ts`)
- Utilities: camelCase (`timeAgo`, `formatBytes`)
- CSS: kebab-case for custom classes (`card-header-accent`, `grid-texture`)

## 11. Pre-Ship Checklist

Before declaring any UI task done:

- [ ] All text passes WCAG AA contrast
- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Focus states visible on all interactive elements
- [ ] No layout shift on load (CLS)
- [ ] Mobile responsive (test at 375px, 768px, 1024px)
- [ ] Loading states for async data
- [ ] Error states with retry actions
- [ ] Empty states with helpful guidance
- [ ] All strings use i18n (`useTranslations`)
- [ ] No hardcoded colors (use token variables)
- [ ] No em-dashes in any visible text
- [ ] Build passes (`next build`)
- [ ] No TypeScript errors
- [ ] Interactive elements have aria-labels where needed
