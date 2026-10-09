# MEDGUARD design system

A specification that lets the frontend be rebuilt as a Figma library. No Figma file was created; there was no Figma integration in the build environment. The single source of truth for the tokens is `src/index.css` (CSS variables), and Tailwind maps to it in `tailwind.config.js`. The primitives are in `src/components/ui.tsx`.

## 1. Brand concept
MEDGUARD is a precise, calm clinical review workspace for the Healthcare Record Contradiction Detector (tagline: *Find contradictions. Preserve clinical context. Support better decisions.*). The mark (`src/components/shell/BrandMark.tsx`, `public/favicon.svg`) is a guard shield framing two record lines, standing for protecting the integrity of the record. The wordmark is MEDGUARD in bold with 0.08em tracking, and the descriptor is "Contradiction Detector".

## 2. Design principles
1. **Evidence first.** Quotations are the most legible element on a screen. Interpretation is visually secondary and labelled as interpretation.
2. **Honest states.** Nothing is shown as working unless it was checked. Demo, synthetic and local-only states are always labelled.
3. **Colour has meaning.** Red is conflict or danger, amber is uncertainty or caution, green is completion, blue is neutral information, and teal is brand. Colour is never the only signal: every status badge has text and an icon.
4. **Restraint.** 1px borders, small radii, one card shadow. No gradients or decorative shapes.
5. **Density with hierarchy.** Dense tables use 13.5px text with an 11.5px uppercase header row.

## 3. Colour tokens (`:root` in `src/index.css`)
| Token | Value | Use |
|---|---|---|
| `--app-bg` | #F5F7FA | page background |
| `--surface` / `--surface-subtle` / `--surface-hover` | #FFFFFF / #F8FAFC / #F1F5F9 | cards / table header and quiet fills / hover |
| `--text-primary` | #152536 | headings, body |
| `--text-secondary` | #526579 | descriptions, labels |
| `--text-muted` | #66768A | meta text (darkened from #8090A0 for 4.5:1 contrast) |
| `--border` / `--border-strong` | #E2E8F0 / #CBD5E1 | dividers / hover borders |
| `--brand` / `-hover` / `-strong` / `-subtle` | #176B67 / #115651 / #0E4744 / #E5F4F1 | identity, primary actions, active navigation |
| `--danger` / `-subtle` | #C43D4D / #FCEBED | conflicts, high priority, confirmed contradiction |
| `--warning` / `-subtle` | #9A6412 / #FFF4DB | uncertainty, needs information (darkened from #B7791F for text contrast) |
| `--success` / `-subtle` | #1F7A54 / #E6F6ED | resolved, expected change, verified quote |
| `--info` / `-subtle` | #356AC3 / #EAF1FF | in review, informational |

Tailwind names: `canvas surface subtle hover ink muted faint line line-strong brand ok warn crit info`.

## 4. Typography
Inter Variable is bundled locally (`@fontsource-variable/inter`), so it works offline, with a system UI fallback. Monospace uses the system mono stack and is reserved for IDs and offsets.

| Role | Size / weight |
|---|---|
| Page title | 26–28px / 600, −0.02em |
| Section / card title | 15px / 600 |
| Selected finding title | 19–20px / 600 |
| Body | 13.5–14.5px / 400, line-height 1.5–1.6 |
| Evidence quotation | 14px / 400, relaxed |
| Labels / meta | 11.5–13px |
| Eyebrow | 11px / 600 uppercase, 0.07em |
| Metric value | 30px / 600, tabular numerals |

## 5. Spacing
A 4px base. 4 is micro, 8 is compact, 12 separates related controls, 16 is standard, 20 is card padding (`p-5`), 24 separates sections (`gap-6`), and 32 is page padding at desktop (`lg:px-8`).

## 6. Radius and borders
Buttons and inputs 9px, chips 6px, cards 12px (`rounded-card`), panels and dialogs 14px (`rounded-panel`). Every surface has a 1px `--border`.

## 7. Shadows
- `shadow-card`: 0 1px 2px at 5% (all cards).
- `shadow-raised`: hover on metric cards, toasts.
- `shadow-overlay`: dialogs, drawers, menus, command palette.

## 8. Icons
Lucide React only, 15–18px, default stroke. Icon-only buttons have an `aria-label` and a tooltip. No emoji.

## 9. Buttons
| Class | Use |
|---|---|
| `btn-primary` | one main action per area (teal) |
| `btn-secondary` | secondary actions (white, bordered) |
| `btn-ghost` | tertiary or inline |
| `btn-danger` | destructive confirmation only |
| `btn-icon` | 36px square icon button |
| `btn-sm` | 32px height variant |

States: hover darkens or fills `--surface-hover`, disabled is 50% opacity with a not-allowed cursor, focus shows a 2px teal outline with 2px offset.

## 10. Inputs
`.input` is 36px high with a 9px radius. Focus shows a brand border and a 3px brand/15 ring. `SearchInput` adds a leading icon. `SelectField` has a custom chevron and an accessible (visually hidden) label. `Toggle` is a `role="switch"` button. Validation messages are 12px danger text with `role="alert"`.

## 11. Review status (badge = text + icon + tone)
| Status | Tone | Icon |
|---|---|---|
| Unreviewed | neutral | dashed circle |
| In review | info | dot |
| Needs more information | warn | question |
| Confirmed discrepancy | crit | octagon |
| Unable to determine | warn | question |
| Expected change | ok | history |
| Resolved by reviewer | ok | check |
| Dismissed — not a contradiction | neutral | x |

## 12. Severity
Severity is the engine's workflow review priority, not a clinical risk score: **High** (crit, triangle), **Medium** (warn, triangle), **Informational** (info, i). A tooltip explains this on every badge.

Finding nature is shown separately: potential contradiction, temporal difference, missing or uncertain information, uncertain extraction, human-confirmed.

## 13. Tables
Class `.table`: separate borders, a sticky uppercase header on `--surface-subtle`, 12px cell padding, `row-link` hover. Rows are clickable, and links and buttons inside them keep their own behaviour. Below `lg`, tables become stacked card lists. Applied filters appear as removable `FilterChip`s with "Clear all".

## 14. Dialogs and drawers
- `Modal`: centred, bottom sheet on mobile, focus trap, Escape to close, restores focus.
- `ConfirmDialog`: wraps `Modal` for destructive confirmations.
- `Drawer`: right side, 680px, for finding quick-preview.
- `CommandPalette`: Ctrl/Cmd+K or `/`, combobox and listbox semantics, arrow and Enter navigation.

## 15. Empty states
A dashed-border panel with an icon tile, a title, a one-sentence explanation and a next action. When analysis found nothing, the wording is always "No potential contradictions were detected by the available rules." with a caveat about rule coverage.

## 16. Loading states
Skeletons (`PageSkeleton`) appear only while IndexedDB queries resolve. Spinners appear only on real work (analysis, OCR, restore). There are no artificial delays.

## 17. Breakpoints
| Width | Layout |
|---|---|
| < 768 | drawer navigation, stacked cards, bottom-sheet dialogs |
| 768–1023 | two-column grids, tables with horizontal scroll where needed |
| ≥ 1024 (`lg`) | 248px sidebar (76px collapsed), case workspace in two columns |
| ≥ 1280 (`xl`) | overview 2/3 + 380px aside, review queue list + workspace |
| ≥ 1536 (`2xl`) | case workspace in three columns (300px · fluid · 360px) |

The content maximum is 1600px. All nine target viewports (1920×1080 down to 390×844) were checked for horizontal overflow.

## 18. Accessibility
- Semantic landmarks and a skip link.
- Every page has a single `h1`.
- Labelled controls and `aria-current` on navigation and selected items.
- Visible focus everywhere.
- Charts carry an `aria-label` plus a visually hidden data table.
- `prefers-reduced-motion` is honoured, and Settings has a reduce-motion toggle.
- Text contrast is at least 4.5:1 for body and meta text.

## 19. Component inventory
| Area | Components |
|---|---|
| Shell | `AppShell`, `NavItem`, `Breadcrumbs`, `ModeChip` (workspace badge), `Notifications`, `UserMenu`, `CommandPalette`, `BrandMark` |
| Data display | `MetricCard`, `StatusBadge`, `SeverityBadge`, `TypeBadge`, `NatureBadge`, `SyntheticBadge`, `ProgressBar`, `FilterChip`, `EmptyState`, `ErrorState`, `Skeleton`, `KeyValue`, `FindingsTable`, `CaseStateBadge` |
| Clinical review | `EvidenceComparison`, `EvidenceCard`, `ReviewPanel` (decision form + reviewer notes), `DecisionHistory`, `FindingExplanation`, `AnalysisSummaryList` |
| Forms | `SearchInput`, `SelectField`, `Toggle`, `.input`, file dropzone (Documents) |
| Overlays | `Modal`, `ConfirmDialog`, `Drawer`, `Tooltip`, toasts |
| Charts | `BarList` (category distribution), `Donut` (review status), `StackedBar`, `ChartLegend` |

## 20. Page layouts
| Page | Layout |
|---|---|
| Overview | header + LOCAL DEMO badge, ready-for-analysis callouts, 4 metrics, [categories + open contradictions] \| [review donut, activity, environment] |
| Clinical Cases | toolbar (search, status, severity, category, sort, chips) and a dense case table |
| Case workspace | header, 4 metrics, [summary, documents, findings] · [evidence + explanation] · [decision + history], then record dates, export, AI |
| Contradictions | type tabs, filter toolbar, findings table, quick-preview drawer |
| Review Queue | 5 status counts, filters, [queue list 400px] \| [review workspace] |
| Documents | case selector, import dropzone, document table |
| Activity | filter toolbar, day-grouped event list with seeded/local origin |
| Settings | storage stats, capability status, demonstration controls, shared workspace (optional) |
| Help | workflow, definitions, judge guide |
