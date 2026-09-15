---
name: BurnerByte
description: Self-hosted temporary email platform for technical teams
colors:
  background: "oklch(0.984 0.004 265)"
  foreground: "oklch(0.16 0.028 265)"
  card: "oklch(0.998 0.0015 265)"
  card-foreground: "oklch(0.16 0.028 265)"
  popover: "oklch(0.998 0.0015 265)"
  popover-foreground: "oklch(0.16 0.028 265)"
  primary: "oklch(0.52 0.215 264)"
  primary-foreground: "oklch(0.99 0.002 265)"
  secondary: "oklch(0.965 0.006 265)"
  secondary-foreground: "oklch(0.30 0.02 265)"
  muted: "oklch(0.965 0.006 265)"
  muted-foreground: "oklch(0.46 0.018 265)"
  accent: "oklch(0.945 0.012 265)"
  accent-foreground: "oklch(0.30 0.02 265)"
  destructive: "oklch(0.577 0.245 27)"
  destructive-foreground: "oklch(0.985 0 0)"
  success: "oklch(0.60 0.17 155)"
  success-foreground: "oklch(0.985 0 0)"
  warning: "oklch(0.75 0.16 70)"
  warning-foreground: "oklch(0.25 0.04 70)"
  info: "oklch(0.60 0.15 245)"
  info-foreground: "oklch(0.985 0 0)"
  border: "oklch(0.90 0.006 265)"
  ring: "oklch(0.52 0.215 264)"
  sidebar: "oklch(0.972 0.006 265)"
  sidebar-foreground: "oklch(0.16 0.028 265)"
  sidebar-primary: "oklch(0.65 0.19 45)"
  sidebar-primary-foreground: "oklch(0.985 0 0)"
  sidebar-accent: "oklch(0.945 0.01 265)"
  sidebar-accent-foreground: "oklch(0.30 0.02 265)"
  sidebar-border: "oklch(0.92 0.005 265)"
  chart-1: "oklch(0.65 0.19 45)"
  chart-2: "oklch(0.55 0.18 250)"
  chart-3: "oklch(0.60 0.15 165)"
  chart-4: "oklch(0.55 0.18 310)"
  chart-5: "oklch(0.58 0.20 25)"
typography:
  body:
    fontFamily: "Geist Sans, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Sans, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  title:
    fontFamily: "Geist Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Geist Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "7px"
  md: "9px"
  lg: "11px"
  xl: "15px"
  "2xl": "19px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  input-default:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  card-default:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "9999px"
    padding: "2px 8px"
  badge-success:
    backgroundColor: "{colors.success}/10"
    textColor: "{colors.success}"
    borderColor: "{colors.success}/20"
    rounded: "9999px"
    padding: "2px 8px"
  badge-warning:
    backgroundColor: "{colors.warning}/10"
    textColor: "{colors.warning}"
    borderColor: "{colors.warning}/20"
    rounded: "9999px"
    padding: "2px 8px"
  badge-info:
    backgroundColor: "{colors.info}/10"
    textColor: "{colors.info}"
    borderColor: "{colors.info}/20"
    rounded: "9999px"
    padding: "2px 8px"
---

# Design System: BurnerByte

## 1. Overview

**Creative North Star: "The Workshop Bench"**

BurnerByte is honest infrastructure laid out the way an experienced operator would lay out a workbench: every tool visible, every tool within reach, nothing hidden behind chrome, nothing decorative. The system is calm because the work is serious, not because it is precious. Density appears where the work needs it (audit logs, settings tables, inbox lists); breathing room appears where attention needs it (destructive confirmations, primary actions, real-time updates). Neither is the default.

The aesthetic rejects four neighbouring patterns. Marketing-led SaaS dashboards lean on promotional chrome and competing colors; BurnerByte is infrastructure, not a funnel. Screenshot-driven dev tools use dark mode as a fashion statement and gradients as decoration; BurnerByte chooses light and reserves color for meaning. Undifferentiated enterprise consoles deliver everything at one weight; BurnerByte ranks information visibly. Ad-supported disposable inbox services surround the mailbox with ad units and offer no access control; BurnerByte should be something a security team can defend in a procurement review.

The system is light only: the app is locked to the light theme via the theme provider (`forcedTheme="light"`), and a dark theme is intentionally not shipped at this time. Color is restrained: a single indigo accent for primary actions and focus states, a warm amber reserved exclusively for sidebar active state and chart accents. Everything else is a tinted neutral on the indigo hue axis. Visual intensity is rationed.

**Key Characteristics:**
- Restrained color strategy: tinted neutrals plus one accent at ≤10% surface coverage
- Single type family (Geist Sans) carrying every role through weight and size contrast
- Flat by default; shadows appear only as state feedback or semantic elevation
- 150–250ms transitions with exponential ease-out; no choreography, no bounce
- Tabular figures on every numeric display; mono reserved for IDs, addresses, code
- Information density permitted where it serves the work; never decorative density

## 2. Colors

A cool-tinted neutral palette built on a single indigo accent, with a warm amber reserved for one purpose and one purpose only. Every color is defined in OKLCH for perceptual uniformity across the lightness range; chroma is reduced as lightness approaches the extremes to avoid garish edges. The app currently ships only the light token set below; a dark theme is not implemented (the theme provider forces light).

### Primary
- **Indigo Accent** (`oklch(0.52 0.215 264)`). Primary actions, focus rings, active selection indicators, links. The single dominant accent, deep and confident. Used on ≤10% of any given screen; its rarity is the point.

### Secondary
- **Sidebar Amber** (`oklch(0.65 0.19 45)`). Sidebar active background tint, chart-1 series only. Reserved. Never competes with indigo on the same surface; never used for buttons, badges, links, or general accent.

### Neutral
- **Ink** (`oklch(0.16 0.028 265)`). Primary text. Indigo-tinted near-black, never pure black.
- **Subdued** (`oklch(0.46 0.018 265)`). Secondary text, labels, placeholders, metadata.
- **Whisper** (`oklch(0.965 0.006 265)`). Muted and secondary surfaces, hover fills, table stripe.
- **Accent Field** (`oklch(0.945 0.012 265)`). Selected list rows, active filter chips, ghost-button hover.
- **Paper** (`oklch(0.984 0.004 265)`). Page background. Cool indigo-tinted, never pure white.
- **Porcelain** (`oklch(0.998 0.0015 265)`). Card and popover surfaces. Slightly brighter than paper; separation is reinforced by soft layered elevation, not a heavy border.
- **Wire** (`oklch(0.90 0.006 265)`). Borders, dividers, input strokes. Deliberately soft: cards lean on elevation, not heavy lines.

### Semantic
- **Destructive** (`oklch(0.577 0.245 27)`). Errors, delete actions, critical alerts.
- **Success** (`oklch(0.60 0.17 155)`). Confirmed states. Always paired with an icon.
- **Warning** (`oklch(0.75 0.16 70)`). Cautionary states. Always paired with an icon.
- **Info** (`oklch(0.60 0.15 245)`). Neutral notices. Always paired with an icon.

### Chart Series
Five series, deliberately not in a single hue family. Used in `recharts` visualizations only.
- Chart 1 amber (`oklch(0.65 0.19 45)`), Chart 2 blue (`oklch(0.55 0.18 250)`), Chart 3 green (`oklch(0.60 0.15 165)`), Chart 4 violet (`oklch(0.55 0.18 310)`), Chart 5 red-orange (`oklch(0.58 0.20 25)`).

### Named Rules

**The Quiet Accent Rule.** Primary indigo appears on ≤10% of any screen. If you reach for it a fourth time on the same view, one of those uses is wrong. Demote to outline, ghost, or neutral.

**The Amber Reservation Rule.** Sidebar amber is reserved for two surfaces: sidebar active state, and chart-1 series. It never appears on buttons, badges, links, alerts, or general decoration. Repurposing it weakens the one place it earns attention.

**The No Naked Status Rule.** Status colors (success, warning, info, destructive) are never the sole signal. Every colored status element is paired with an icon and, where space permits, a text label. Color-blind users must never guess.

## 3. Typography

**Body Font:** Geist Sans (with system-ui, -apple-system fallback).
**Mono Font:** Geist Mono (with ui-monospace fallback).

**Character:** A single sans-serif family carries every role, hierarchy emerging from weight and size contrast rather than family switching. Geist Sans's even rhythm and tabular figures keep it comfortable in dense data tables and spacious headings. The mono face appears only where character width carries meaning: email addresses, inbox IDs, countdowns, code.

### Hierarchy
- **Headline** (700, 1.75rem / 1.15, `-0.025em` tracking). Page titles. One per view. Used via the `text-headline` utility.
- **Title** (600, 1.125rem / 1.3). Section headings, card titles, dialog headers. `text-title` utility.
- **Body** (400, 0.875rem / 1.5). All running text. Cap line length at 65–75ch for prose; tables and dense UI may run wider.
- **Label** (500, 0.75rem / 1.4, `0.01em` tracking). Form labels, metadata, timestamps, badge text. `text-label` utility.
- **Mono** (400, 0.8125rem / 1.5). Email addresses, inbox IDs, countdowns, code snippets, copyable values.

### Named Rules

**The One Family Rule.** Geist Sans carries everything. No display font, no decorative pairing, no display-only weight. Hierarchy is achieved through weight (400→700) and size (0.75rem→1.75rem), never through family switching.

**The Tabular Figures Rule.** All numeric displays (countdowns, statistics, table columns, IDs) use `font-variant-numeric: tabular-nums` via the `tabular-nums` utility so digits do not shift width during updates.

**The Mono Reservation Rule.** Geist Mono appears only where character-width is informational: addresses, IDs, code, countdowns, copyable identifiers. It is not used to make body copy look "technical" or "developer-friendly".

## 4. Elevation

Restrained but real. Surfaces are distinguished primarily by background tint (Paper, Porcelain, Whisper, Accent Field) and reinforced by soft, layered shadows tinted to the indigo axis, never flat black. Depth reads as the same material as the rest of the system. The scale is defined as Tailwind's `shadow-*` tokens, overridden to the tinted, two-layer values below, so every elevated element is cohesive.

### Shadow Vocabulary
- **Ambient** (`shadow-xs`). Cards at rest. A soft two-layer indigo-tinted lift (about 5-8% alpha) that defines the surface without shouting.
- **Inset** (`inset 0 1px 2px rgb(30 27 75 / 0.05)`). Input fields. Recessed feel without heavier borders.
- **Hover** (`shadow-md`). Genuinely clickable cards on hover. A clear lift confirming the affordance.
- **Elevated** (`shadow-lg` / `shadow-xl`). Popovers, dropdowns, command palette, dialogs. Clear separation from the page beneath.

### Named Rules

**The Restrained-Elevation Rule.** Resting cards carry the ambient shadow and nothing more. Deeper shadow is earned through interaction (hover on a clickable card) or semantic elevation (a floating element). Shadows outside the defined scale, or used decoratively, are prohibited.

**The No Stacked Lift Rule.** A card already at ambient elevation does not get a hover lift unless the entire card is interactive. Cards that contain interactive children but are not themselves clickable keep only the ambient shadow.

## 5. Components

### Buttons

A consistent shape across all variants; differentiation through fill and border, never through radius or shadow.

- **Shape:** Rounded-md (9px radius) across every variant. Default height 40px (h-10); sm 32px (h-8); xs 24px (h-6); icon variants use matching square sizes.
- **Primary (default):** Indigo background, white text. Padding 8px 16px. Hover drops opacity to 90%. No scale transform.
- **Destructive:** Destructive red background, white text. Same geometry as primary. Focus ring uses `destructive/20`.
- **Outline:** Transparent background, 1px border in Wire color, foreground text. Hover fills with Accent Field background.
- **Secondary:** Secondary tint background, secondary-foreground text. Hover drops opacity to 80%.
- **Ghost:** No border, no background. Hover fills with Accent Field. Used in toolbars, table action columns, and dense UI.
- **Link:** Indigo text with underline on hover. Used for inline actions in body copy only.
- **Focus:** 3px ring in `primary/50` (`destructive/20` for destructive), no inset. Visible on keyboard navigation only via `focus-visible`.
- **Disabled:** 50% opacity, `pointer-events: none`. No separate disabled color token.

### Inputs

- **Shape:** Rounded-md (9px), 1px border in Wire color, transparent background.
- **Height:** 36px (h-9). Compact for dense forms and aligned with the platform's information-density posture.
- **Inset shadow:** Subtle (`inset 0 1px 2px rgb(30 27 75 / 0.05)`) for recessed feel without heavier borders.
- **Focus:** Border shifts to primary, 3px ring in `primary/50`. Transition limited to color and box-shadow (never layout).
- **Error:** Border shifts to destructive, ring in `destructive/20`. Triggered by `aria-invalid`.

### Cards

- **Shape:** Rounded-xl (15px radius), 1px border, Porcelain background.
- **Shadow:** Ambient at rest (`shadow-xs`, soft two-layer indigo-tinted). No hover lift unless the card is itself the click target, in which case `hover:shadow-md`.
- **Internal layout:** Gap-6 (24px) between header, content, and footer regions. Internal padding `py-6 px-6`.
- **Header accent (optional):** A 2px top border at `primary/15` (`card-header-accent` utility) for cards that need a quiet semantic header marker. Never used decoratively.
- **No nested cards.** Ever. If you need hierarchy inside a card, use background tint (Accent Field over Porcelain) or spacing.

### Badges

- **Shape:** Fully rounded pill, padding 2px 8px, text at 0.75rem 500 weight.
- **Default:** Indigo background, white text. For primary identification only.
- **Secondary / outline / ghost:** Neutral surfaces for non-semantic labels.
- **Destructive:** Red fill, white text.
- **Success / Warning / Info:** Pattern is `bg-{color}/10 text-{color} border-{color}/20`. Always paired with an icon. The tinted background plus matching text keeps the badge readable without shouting.

### Sidebar Navigation

- **Width:** 240px expanded, 60px collapsed. Transition 200ms ease-out on width only (never on layout properties beyond width).
- **Item shape:** Rounded-lg (11px), 6px / 8px internal padding.
- **Resting state:** `text-muted-foreground` over transparent. Hover fills `muted/80` and promotes text to foreground.
- **Active state:** `bg-sidebar-primary/10 text-sidebar-primary` (the reserved amber) plus a 2px-wide, 20px-tall rounded indicator bar positioned absolutely at the left edge in sidebar amber. This indicator is rendered as a separate `<span>`, not via `border-left`, and is the single approved left-edge accent in the system. Amber lives here and in chart-1 only; because it must not compete with indigo on the same surface, the org and user avatars in the sidebar stay neutral (`bg-muted`).
- **Section dividers:** `border-t` at 50% opacity, never full-width rules.
- **Collapsed state:** Items center, label hidden, tooltip on hover.

### Command Palette

- **Trigger:** Cmd+K / Ctrl+K, also available via the help shortcut sheet.
- **Shape:** Rounded-xl, elevated shadow, centered overlay.
- **Search:** Full-width input, no border, large text.
- **Results:** Grouped by category, keyboard-navigable, highlighted match text. Includes recent actions surface.

### Tables

- **Body rows:** Optional zebra striping via `table-striped` utility (`bg-muted/30` on even rows).
- **Numeric columns:** Always tabular-nums; right-aligned for values, left-aligned for labels and identifiers.
- **Action columns:** Ghost buttons (`button-ghost`) for inline actions; do not nest cards or use raised buttons inside table cells.
- **Density:** Default row height matches input height (36px) for visual alignment between editable and read-only data.

### Toasts (Sonner)

- **Shape:** Rounded-md, elevated shadow, bottom-right placement.
- **Variants:** Default, success, error, warning, info. Each carries the matching semantic color plus an icon.
- **Duration:** Auto-dismiss at 4s for confirmations, 6s for warnings, persistent for errors requiring action.

## 6. Do's and Don'ts

### Do:

- **Do** use semantic color tokens (`bg-primary`, `text-destructive`, `bg-muted`, `border-wire`) for every color assignment. Hard-coded Tailwind colors (`bg-emerald-500`, `text-red-600`) are prohibited in component code.
- **Do** pair every status color with an icon, and with a text label where space permits. A green dot alone means nothing to a color-blind user.
- **Do** use `font-variant-numeric: tabular-nums` (or the `tabular-nums` utility) on all numeric displays, including countdowns, statistics, table columns, and identifiers.
- **Do** respect `prefers-reduced-motion`. The global stylesheet already disables transitions and animations for users who request it; do not bypass this in component-local CSS.
- **Do** provide `aria-label` on every icon-only button. Title attributes are insufficient for screen readers.
- **Do** use exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) for transitions and animations. Never `ease-in-out` for slide or reveal motion.
- **Do** keep transitions between 150–250ms. Users are in flow; do not make them wait.
- **Do** use background tints (Accent Field over Porcelain, `bg-primary/10` for active) to indicate selected or active states in lists, never side-stripe borders.
- **Do** reserve sidebar amber for sidebar active state and chart-1 only. Every other accent is indigo.
- **Do** keep empty states to one line of useful text and (where helpful) a single primary action. No characters, no decoration.

### Don't:

- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent on cards, list items, callouts, or alerts. The sidebar's 2px active indicator is rendered as an absolutely-positioned `<span>` for this reason; it is the one approved exception.
- **Don't** use `background-clip: text` with gradients. Gradient text is decorative and never meaningful. Emphasis comes from weight or size.
- **Don't** use glassmorphism (`backdrop-blur` plus transparency) decoratively. If blur appears, it must serve a function (e.g. sticky header over scrolling content).
- **Don't** reach for dark-mode styling cues as decoration: no purple gradients, no neon accents, no glow effects. The system is light-only; if a dark theme is ever added it must be a parallel functional theme, not a visual posture.
- **Don't** create identical card grids (same-sized cards with icon + heading + text repeated endlessly). Vary sizes, use asymmetric layouts, or choose a different structure entirely.
- **Don't** use hero-metric templates inside the product (big number + small label + supporting stats + gradient accent). That pattern belongs to a marketing page, not a dashboard.
- **Don't** add cute illustrated empty states. No hand-drawn characters, no pastel scenes, no mascots. A single sentence and (where useful) a primary action.
- **Don't** nest cards inside cards. Use background tint (Accent Field over Porcelain) or spacing for hierarchy within a card.
- **Don't** use display or decorative typefaces in UI labels, buttons, or data. Geist Sans carries everything; mono is reserved for character-width-meaningful values only.
- **Don't** add `animate-ping` or other persistent attention-seeking animation for static status indicators. A colored dot paired with an icon is sufficient. Reserve animation for transient events (incoming email, count change).
- **Don't** add decorative motion: no orchestrated page-load sequences, no bounce, no elastic easing, no spring physics.
- **Don't** repurpose chart colors for non-chart UI. Chart 1–5 exist as a series; pulling chart-4 (violet) into a badge breaks the system.
