# MEDGUARD — Design System (as implemented)

> This file documents what the code renders. The design rationale and the Figma-oriented specification are in [`../FIGMA_DESIGN_SYSTEM.md`](../FIGMA_DESIGN_SYSTEM.md).
> **Source of truth:**
> - tokens: `src/index.css` `:root`;
> - Tailwind mapping: `tailwind.config.js`;
> - primitives: `src/components/ui.tsx`;
> - shell: `src/components/shell/AppShell.tsx`.

## 1. Brand

| Element | Implementation | Location |
|---|---|---|
| Product name | **MEDGUARD**. Wordmark in bold with a "Contradiction Detector" descriptor in the sidebar | `AppShell.tsx` (`Brand`), `index.html` `<title>` |
| Tagline (metadata) | "Find contradictions. Preserve clinical context. Support better decisions." | `index.html` meta description / Open Graph |
| Mark | 32×32 rounded square in `--brand`, with a white shield outline framing two "record lines". Original inline SVG | `src/components/shell/BrandMark.tsx`, `public/favicon.svg` |
| Theme colour | `#176B67` | `index.html` `meta[name=theme-color]` |
| Font | Inter Variable (bundled, `@fontsource-variable/inter`); system-font fallback stack; system monospace stack for offsets | `src/index.css:1`, `tailwind.config.js` |

**PWA status:** there is no web app manifest. A service worker exists for offline caching only.

## 2. Colour tokens

All values are verified from `src/index.css`. Contrast ratios were computed in this audit using the WCAG 2.x relative-luminance formula.

| Token | Hex | Role | Contrast (as used) |
|---|---|---|---|
| `--app-bg` | #F5F7FA | Page background | n/a |
| `--surface` | #FFFFFF | Cards, panels, header | n/a |
| `--surface-subtle` | #F8FAFC | Table headers, quiet fills | n/a |
| `--surface-hover` | #F1F5F9 | Hover rows and buttons | n/a |
| `--text-primary` | #152536 | Headings, body | 15.56:1 on white |
| `--text-secondary` | #526579 | Descriptions, labels | 6.01:1 on white |
| `--text-muted` | #66768A | Meta text, eyebrows | 4.64:1 on white; **4.33:1 on `--app-bg`** (below 4.5:1 for body text) |
| `--border` / `--border-strong` | #E2E8F0 / #CBD5E1 | Dividers / hover borders | n/a |
| `--brand` | #176B67 | Primary buttons, active nav, focus ring | white text on brand: 6.30:1 |
| `--brand-hover` / `--brand-strong` | #115651 / #0E4744 | Hover, pressed, brand text on tint | brand-strong on brand-subtle: 9.26:1 |
| `--brand-subtle` / `--brand-100` | #E5F4F1 / #CDEAE4 | Brand tints | n/a |
| `--danger` / `-subtle` | #C43D4D / #FCEBED | Conflicts, high priority, confirmed | **4.43:1** on its tint (slightly below 4.5:1) |
| `--warning` / `-subtle` | #9A6412 / #FFF4DB | Uncertainty, needs info | 4.57:1 on its tint |
| `--success` / `-subtle` | #1F7A54 / #E6F6ED | Resolved, expected change, verified quote | 4.73:1 on its tint |
| `--info` / `-subtle` | #356AC3 / #EAF1FF | In review, informational | 4.63:1 on its tint |
| Evidence highlight | `#FFF1B8` background, `#B7791F` underline | `mark.evidence-hl` in source text | n/a |

Tokens are stored as RGB channels, so Tailwind opacity modifiers work (`bg-brand/10`). There is no dark mode: only a light theme is defined.

## 3. Typography, spacing, shape and motion

| Element | Design decision | Implementation |
|---|---|---|
| Base text | 14 px / 1.5, Inter, antialiased | `src/index.css` `body` |
| Small text | `text-2xs` 11 px / 16 px; table headers 11.5 px uppercase, tracked 0.05em; eyebrow 11 px uppercase, 0.07em | `tailwind.config.js`, `.table thead th`, `.eyebrow` |
| Headings | `--text-primary`, letter-spacing −0.011em | `src/index.css` base layer |
| Spacing | Tailwind default 4 px scale. Page padding `px-4` / `md:px-6` / `lg:px-8`. Max content width 1600 px | `AppShell.tsx` `<main>` |
| Radii | Buttons and inputs 9 px; cards 12 px (`rounded-card`); panels and dialogs 14 px (`rounded-panel`) | `tailwind.config.js`, `src/index.css` |
| Shadows | `card` (1 px, very soft), `raised`, `overlay` (dialogs, popovers) | `tailwind.config.js` `boxShadow` |
| Layout constants | Sidebar 248 px, compact sidebar 76 px, header 64 px | CSS variables `--sidebar-w`, `--sidebar-w-compact`, `--header-h` |
| Motion | 150 / 200 / 260 ms; `fade-up`, `fade-in`, `slide-in` (drawers), `pop` (dialogs) | `tailwind.config.js` keyframes |
| Reduced motion | Honours `prefers-reduced-motion`, plus a manual "Reduce motion" toggle in Settings (`.reduce-motion` class) | `src/index.css`, `src/app/state.tsx` |

## 4. Components

| Element | Design decision | Implementation location |
|---|---|---|
| Buttons | `.btn-primary` (teal), `.btn-secondary` (bordered), `.btn-ghost`, `.btn-danger`, `.btn-icon`, `.btn-sm`. Height 36 px (32 px small) | `src/index.css` components layer |
| Badges / chips | Tones: neutral, brand, info, warn, crit, ok, dark. Each has text **and** an icon. Status, severity, type, nature, category, synthetic-data badges | `ui.tsx` `Badge`, `StatusBadge`, `SeverityBadge`, `TypeBadge`, `NatureBadge`, `SyntheticBadge` |
| Review status colours | unreviewed = neutral, in review = info, needs info / undetermined = warn, confirmed = crit, resolved / expected change = ok, dismissed = neutral | `ui.tsx` `STATUS_STYLE` |
| Severity | high = crit, medium = warn, informational = info. Tooltip: "Workflow review priority … Not a clinical risk score." | `ui.tsx` `SeverityBadge`, `lib/metrics.ts` |
| Evidence quality | Bar-style indicator + label ("High / Moderate / Limited evidence availability"). Explicitly *not* a confidence score | `ui.tsx` `QualityIndicator` |
| Cards / sections | `.card`, `.panel`, `SectionCard`, `MetricCard` (with optional progress bar and link) | `src/index.css`, `ui.tsx` |
| Tables | `.table` with sticky uppercase header and clickable `row-link` rows | `src/index.css`, `components/clinical.tsx` `FindingsTable` |
| Filters | `SearchInput`, `SelectField`, `FilterChip`, segmented controls | `ui.tsx` |
| Dialogs | `Modal` and `ConfirmDialog`: `role="dialog"`, `aria-modal`, Escape to close, focus restored to the trigger, bottom sheet on mobile | `ui.tsx:353-380` |
| Side panels | `Drawer` (right slide-in, max 680 px) for the finding preview on Contradictions | `ui.tsx:382` |
| Charts | Custom `BarList`, `Donut`, `StackedBar`, `ChartLegend`. Each includes an accessible summary and a visually hidden data table | `components/charts.tsx` |
| Navigation | Sidebar groups: Overview, Clinical Cases, Contradictions, Documents, Review Queue (pending badge), Activity; then Settings, Help & About. Collapsible sidebar | `AppShell.tsx` `NAV`, `NAV_BOTTOM` |
| Breadcrumbs | Derived from the route, e.g. Overview › Contradictions › DEMO-0042 › CS-XXXX | `AppShell.tsx` |
| Search | Ctrl/Cmd+K command palette over cases, aliases, findings and documents (local only) | `shell/CommandPalette.tsx` |
| Notifications | Bell popover with the pending-review count. Toasts (`aria-live="polite"`; errors use `role="alert"`) | `AppShell.tsx` |
| Loading states | `Spinner`, `Skeleton`, `PageSkeleton`; seeding progress per document; `aria-busy` on Analyze | `ui.tsx`, `AnalyzeButton.tsx` |
| Empty / error states | `EmptyState`, `ErrorState`, app-level `ErrorBoundary`, 404 page | `ui.tsx`, `src/main.tsx` |
| Demo labelling | Top banner "DEMO WORKSPACE · synthetic data — not real patients · runs locally in this browser"; sidebar "Demo environment" card; "Local demo mode" header chip; "Synthetic demo data" badges | `AppShell.tsx`, `ui.tsx` |

## 5. Responsive behaviour

- **Breakpoints:** Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280 px.
- **Below `lg` (< 1024 px):** the sidebar is hidden. A hamburger button opens a modal navigation drawer (`role="dialog"`). The header shows the brand mark only, and the search field collapses to an icon below `md`.
- **Metric cards:** two columns on small screens, four at `xl`.
- **Dialogs:** bottom sheets below `sm`, centred panels above.
- **QA result.** No page overflowed horizontally (`scrollWidth − innerWidth = 0`) at 1440×900 or 390×844. Pages checked: Overview, Cases, Case workspace, Contradictions, Review Queue, Documents, Activity, Settings, Finding detail. The wordmark is fully visible in the desktop sidebar; the mobile header shows the mark only, by design. The e2e test `tests/e2e/mobile.spec.ts` asserts the same overflow rule on a Pixel 7 viewport.

## 6. Accessibility choices (implemented)

- A "Skip to content" link (`AppShell.tsx:62`) targets `main#main` (`tabIndex={-1}`). **Known defect, reproduced in this audit:** because the app uses `HashRouter`, activating the link changes the URL to `#main`, which the router treats as a route, and the "Page not found" screen is shown. The link needs an `onClick` that focuses `#main` without changing the hash.
- `aria-label` on all landmarks (`Main`, `Sidebar`, `Navigation`).
- A visible focus ring on every focusable element: a 2 px `--brand` outline (`:focus-visible`).
- Icon-only buttons have `aria-label`. Decorative icons are `aria-hidden`.
- Status is never conveyed by colour alone: every badge has text and an icon.
- Charts expose text summaries and hidden tables.
- Reduced-motion support, both automatic and manual.
- **Not implemented / not verified:** automated accessibility testing (axe or Lighthouse is not configured); a screen-reader walkthrough; a dark or high-contrast theme. Two token pairs fall slightly below 4.5:1 (see §2).

## 7. Design principles as reflected in the screens

| Principle | How the UI applies it |
|---|---|
| Clinical clarity | Plain-language explanation labelled "generated from a rules template, not quoted evidence". Interpretation is kept visually separate from quotations |
| Information hierarchy | Finding title → badges (priority, category, type, status, synthetic) → why flagged → evidence comparison → review panel → decision history |
| Evidence visibility | Side A / side B cards: verbatim quote, document, date, type, verified page or "not a paged format", section, extraction method, character offsets, "Quote verified against document text", "View in source" |
| Review efficiency | Review Queue with decision workspace; actions limited to valid transitions; reasons required only where needed; Ctrl+K search |
| Reduced cognitive load | One primary action per screen (teal), muted meta text, consistent badge tones |
| Readability | 14 px base, 1.5 line height, high-contrast primary text (15.6:1) |
| Honest states | Mode chip, synthetic labels, "OCR text requires review" warnings, "no numeric confidence score is produced" |

## 8. Screens that exist

Routes are from `src/main.tsx`. Screenshots are in [`screenshots/`](screenshots/); they were captured in this audit from a production build, after analysing DEMO-0042.

| Route | Screen | Desktop | Mobile |
|---|---|---|---|
| `#/` | Clinical Overview | [desktop-overview.png](screenshots/desktop-overview.png) | [mobile-overview.png](screenshots/mobile-overview.png) |
| `#/cases` | Clinical Cases table | [desktop-cases.png](screenshots/desktop-cases.png) | [mobile-cases.png](screenshots/mobile-cases.png) |
| `#/cases/:id`, `#/case` | Case workspace | [desktop-case-workspace.png](screenshots/desktop-case-workspace.png) | [mobile-case-workspace.png](screenshots/mobile-case-workspace.png) |
| `#/contradictions` | Contradictions explorer + drawer | [desktop-contradictions.png](screenshots/desktop-contradictions.png) | [mobile-contradictions.png](screenshots/mobile-contradictions.png) |
| `#/findings/:id` | Finding detail (evidence + review) | [desktop-finding-detail.png](screenshots/desktop-finding-detail.png) | [mobile-finding-detail.png](screenshots/mobile-finding-detail.png) |
| `#/queue` | Review Queue | [desktop-review-queue.png](screenshots/desktop-review-queue.png) | [mobile-review-queue.png](screenshots/mobile-review-queue.png) |
| `#/documents`, `#/documents/:id` | Document library / viewer | [desktop-documents.png](screenshots/desktop-documents.png) | [mobile-documents.png](screenshots/mobile-documents.png) |
| `#/activity` | Activity (audit log) | [desktop-activity.png](screenshots/desktop-activity.png) | [mobile-activity.png](screenshots/mobile-activity.png) |
| `#/settings`, `#/about` | Settings / About | [desktop-settings.png](screenshots/desktop-settings.png) | [mobile-settings.png](screenshots/mobile-settings.png) |
| `#/help` | Help | not captured | not captured |

There is **no login or welcome screen**. Sign-in for the optional shared workspace is a panel inside Settings.
