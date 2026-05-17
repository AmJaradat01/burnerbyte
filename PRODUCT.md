# Product

## Register

product

## Users

Two distinct personas share one self-hosted platform:

**Daily contributors.** Any technical team member who needs a disposable inbox in the flow of work: developers verifying signup flows, QA engineers running test payloads, security professionals probing third-party services, product managers checking onboarding emails, support staff reproducing user issues, ops teams testing alerting. Context is a focused burst inside an active task: create, receive, read, move on. The tool is incidental to the work; speed and silence matter more than features.

**Administrators.** A smaller cohort responsible for the platform itself: provisioning domains, managing teams and roles, reviewing audit logs, configuring SSO, setting attachment policies, watching analytics. Their work is deliberate and governance-shaped: every action has a consequence other people inherit.

The interface serves both without making either feel like a guest. Contributors see a fast, quiet inbox tool. Admins find dense, accountable governance surfaces when they go looking.

## Product Purpose

A self-hosted temporary email platform built for organizations that want full ownership of their disposable inboxes: no third-party data exposure, no per-seat lock-in, no opaque retention. Multi-team, multi-domain, with the access controls, audit trails, and compliance posture that an enterprise security team can defend.

Success has two shapes. For contributors: a fresh inbox in under three seconds, real-time delivery, zero friction between intent and outcome. For administrators: confidence that what happened on the platform is recorded, scoped, and reversible. Both shapes share an underlying outcome: the platform earns trust by being predictable.

## Brand Personality

Sharp, considered, trustworthy. The tool respects expertise without demanding attention, and signals reliability without announcing it. It communicates through precision: tight copy, restrained color, consistent behavior. Trust is built through what does not happen as much as what does. No surprises, no theatre, no upsell.

Three words: **precise, capable, trustworthy.**

## Anti-references

- **Generic SaaS dashboards** (Intercom, HubSpot). Too many competing colors, marketing-heavy chrome, upsell patterns everywhere. BurnerByte is infrastructure, not a funnel.
- **Over-designed dev tools** (Vercel-aesthetic clones). Dark mode as fashion statement, gratuitous gradients, blur effects for their own sake. Aesthetics serve clarity, not screenshots.
- **Enterprise admin panels** (AWS Console, Jira). Information overload, dated component patterns, overwhelming density without hierarchy. Density is fine; chaos is not.
- **Disposable email competitors** (Guerrilla Mail, TempMail). Ad-riddled, visually cheap, zero trust signals. The opposite of what a security team can adopt.
- **Cute illustrated empty states.** Hand-drawn characters, pastel scenes, friendly mascots saying "Nothing here yet!" Patronizing to expert users and inappropriate for governance surfaces. Empty states should be a single line of useful text and, where it helps, a primary action. No characters, no decoration.
- **Marketing-page patterns inside the product.** Hero-metric templates, identical feature-grid card layouts, gradient text headlines, and other landing-page furniture do not belong on product surfaces. If a pattern would feel at home on a homepage, it does not feel at home on a dashboard.

## Design Principles

1. **Disappear into the workflow.** The best tool is the one you forget you are using. No friction between intent and action; no chrome between the user and the data.
2. **Earn every pixel.** Nothing decorative without function. If an element does not help the user complete their task or understand the system, remove it.
3. **Expert confidence.** Assume competence. Show information density where it serves the work; hide complexity where it does not. Never patronize, never explain the obvious, never apologize for being a tool.
4. **Quiet until urgent.** Default state is calm. Reserve visual intensity (color, motion, weight) for things that genuinely demand attention: expiring inboxes, failed deliveries, destructive confirmations, live events.
5. **Accountability is a feature.** Admin surfaces (audit, RBAC, policies, sessions) carry visible consequence. Show who, when, and what; make destructive actions deliberate; preserve a trail. The interface should reinforce the trust the system is built to deserve.

## Accessibility & Inclusion

- WCAG AA across all surfaces as the published baseline.
- WCAG AAA where feasible on critical paths: authentication, destructive confirmations, admin governance (audit, RBAC, policies), and any flow whose failure has compliance consequences. Higher contrast, larger focus indicators, redundant text labels.
- Reduced-motion support (`prefers-reduced-motion`) honoured throughout.
- Color-blind safe status: every colored indicator paired with an icon or text label. Color never carries meaning alone.
- Keyboard-navigable end to end. Command palette, shortcuts, and tab order treated as first-class navigation, not a bolt-on.
- Screen reader support for all interactive elements, including custom controls (dialogs, popovers, command palette, data tables).
- Internationalization: copy lives in message catalogs (next-intl); no hard-coded strings in components. Language-switching is a supported user preference.
