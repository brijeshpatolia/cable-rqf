# Design System — The Instrument

**Cable Quoting App · Nuhas Oman LLC**

The brief: *a Bloomberg terminal and a precision measuring tool.* Dense, quiet, exact. The interface recedes so the data reads.

This document is the enforceable version of that brief. Every value here is a token; nothing in the app uses a raw colour, size, or duration.

---

## 1. The five rules

Everything below follows from these. When a design decision is unclear, resolve it against this list in order.

1. **One accent.** Copper appears on the live copper price and on the single primary action of a screen. Nowhere else. The moment a second decorative colour appears, it stops looking like an instrument.
2. **Status colour on status only.** Green, amber, and red mean match tier and nothing else. Never a coloured button, never a coloured heading, never a coloured background panel.
3. **Structure from alignment, not decoration.** Hairline rules and a shared grid. No shadows (one exception: popovers, which must float above content). Radius ≤ 4px.
4. **Every number is monospace, tabular, right-aligned, decimal-aligned.** This single decision is what separates a costing instrument from a website.
5. **Stillness.** Rows expand. The copper figure ticks. Nothing else moves. Motion reads as toy, not tool.

---

## 2. Colour tokens

The spec fixes eight values. The rest are derived to complete the scale — each earns its place by being needed somewhere, and nothing is added beyond need.

```css
:root {
  /* ── Surface ─────────────────────────────────────── */
  --surface-base:      #0E1116;  /* the working surface */
  --surface-panel:     #161A21;  /* panels, table headers */
  --surface-raised:    #1C212A;  /* popovers, expanded row interior, drawers */
  --surface-hover:     rgba(255, 255, 255, 0.030);
  --surface-active:    rgba(255, 255, 255, 0.055);
  --surface-selected:  rgba(200, 121, 65, 0.070);  /* copper wash, row selection only */

  /* ── Line ────────────────────────────────────────── */
  --line-hairline:     #232833;  /* the default 1px rule — most rules in the app */
  --line-strong:       #2E3542;  /* panel edges, header underline, section dividers */
  --line-focus:        #C87941;

  /* ── Ink ─────────────────────────────────────────── */
  --ink-primary:       #E6E8EB;  /* values, headings */
  --ink-secondary:     #8B929C;  /* labels, supporting text */
  --ink-tertiary:      #5A616B;  /* units, column headers, timestamps */
  --ink-on-copper:     #0E1116;  /* text on the copper button */

  /* ── Copper — the one colour ─────────────────────── */
  --copper:            #C87941;
  --copper-hover:      #D68A55;
  --copper-press:      #B66A36;
  --copper-wash:       rgba(200, 121, 65, 0.120);  /* tick flash, selected row */

  /* ── Status — tiers only ─────────────────────────── */
  --status-exact:      #3FB950;
  --status-review:     #D29922;
  --status-manual:     #F85149;
  --status-exact-wash: rgba( 63, 185,  80, 0.100);
  --status-review-wash:rgba(210, 153,  34, 0.100);
  --status-manual-wash:rgba(248,  81,  73, 0.100);
  --status-neutral:    #5A616B;  /* not yet evaluated / reading */
}
```

### The four tiers in three colours

Four match tiers, three status hues, and rule 2 forbids inventing a fourth. **Fill distinguishes what hue cannot:**

| Tier | Dot | Meaning |
|---|---|---|
| Exact | ● solid green | Priced automatically. Spot-check. |
| Close | ● solid amber | Priced on a substituted material. Check properly. |
| Partial | ○ hollow red (1.5px ring) | **Not priced.** Nearest products shown. |
| No match | ● solid red | Outside the library. Reason stated. |

Solid means *the app committed to something*. Hollow means *the app declined*. Partial and No-match share red because they share a consequence: an engineer must cost this by hand. The distinction the engineer needs first is red-versus-not; the fill tells them whether there's anything to work from.

**Never colour alone.** The dot is always accompanied by its word — `Exact`, `Close`, `Partial`, `No match` — and the same `<StatusDot tier>` component renders it on the inbox, the review screen, and the quote. One component, one legend, one meaning.

### Contrast

Every pair below is checked in CI against its intended size. Failing pairs fail the build.

| Pair | Ratio | Use |
|---|---|---|
| `--ink-primary` on `--surface-base` | 14.8:1 | All values |
| `--ink-secondary` on `--surface-base` | 6.9:1 | Labels — passes AA at 13px |
| `--ink-tertiary` on `--surface-base` | 3.6:1 | Units and column headers only, ≥11px semibold, never load-bearing |
| `--copper` on `--surface-base` | 6.1:1 | Copper price, primary action |
| `--ink-on-copper` on `--copper` | 8.4:1 | Button label |
| `--status-*` on `--surface-base` | 5.4–8.9:1 | Dots and status words |

---

## 3. Typography

Three roles, three faces, no more.

| Role | Face | Fallback (open, ship-ready) |
|---|---|---|
| **Display** — screen titles, the copper price | Neue Haas Grotesk Display / Söhne | **Inter Display** or **Geist** |
| **Body & labels** | Söhne / Neue Haas Text | **Inter** |
| **All numbers** | Berkeley Mono / Söhne Mono | **JetBrains Mono** |

The licensed faces are preferable and swapping is a two-token change — the fallbacks are chosen for matching x-height and identical numeric behaviour, so no layout shifts when they're licensed.

**The numeric face is non-negotiable in its settings:**

```css
--font-mono: 'Berkeley Mono', 'JetBrains Mono', ui-monospace, monospace;

.numeric {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
  font-feature-settings: 'tnum' 1, 'zero' 1, 'ss01' 1;
  text-align: right;
  font-size: 13px;
  letter-spacing: 0;
}
```

Tabular figures make columns align. Slashed zero distinguishes `0` from `O` at 13px, which matters when reading a rate aloud over the phone to a customer.

### Scale

This screen lives at 13–14px. The scale is tight on purpose — a wide type scale makes a dense screen feel like a brochure.

| Token | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| `display-lg` | 28 / 32 | 500 | −0.02em | The live copper price, screen title on Product Detail |
| `display-sm` | 20 / 26 | 500 | −0.015em | Panel titles |
| `heading` | 14 / 20 | 550 | −0.005em | Section headings, table group headers |
| `body` | 13.5 / 20 | 400 | 0 | Everything read as prose |
| `label` | 11 / 14 | 560 | +0.08em, uppercase | Column headers, field labels |
| `numeric` | 13 / 20 | 420 | 0 | Every figure |
| `numeric-lg` | 28 / 32 | 400 | −0.01em | Copper price, quote total |
| `micro` | 11 / 15 | 400 | 0 | Timestamps, audit lines, provenance (mono) |

### Number formatting rules

Consistency here is most of the "premium" perception. Applied by the `<NumericCell>` component, never by hand.

- **Fixed decimals per column type** — a column of rates shows `4.812`, `12.000`, `0.940`. Trailing zeros are kept. Ragged decimals break the ledger.
- **Thousands separator** on values ≥ 1,000: `2,847.312`.
- **Units** trail in `--ink-tertiary` at `micro`, outside the aligned digit block, so they never disturb decimal alignment: `3,647.792 ` `OMR/km`.
- **Zero** renders as `0.000`, never `—`. A dash means *no value exists*; zero is a value.
- **Absent** renders as `—` in `--ink-tertiary`. An unpriced Partial line shows `—` and can never show a number.
- **Negatives** carry a leading minus and are red **only** in delta columns (price watch drift). Never red in a cost column.

---

## 4. Space, grid, density

4px base unit. Every spacing value is a multiple.

```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
--space-5: 24px;  --space-6: 32px;  --space-7: 48px;  --space-8: 64px;

--row-height:      32px;   /* dense — the default */
--row-height-comfy:38px;   /* user preference, persisted */
--cell-pad-x:      12px;
--cell-pad-y:      6px;

--radius-sm: 2px;   /* dots, chips, inputs */
--radius-md: 3px;   /* buttons */
--radius-lg: 4px;   /* panels, drawers — the maximum on a dense screen */

--border-hairline: 1px solid var(--line-hairline);
--border-strong:   1px solid var(--line-strong);
--shadow-popover:  0 8px 24px rgba(0, 0, 0, 0.55);  /* the only shadow */
```

### Two scales, and when each applies

The values above are the **dense** scale and they remain the default. A second
**shell** scale was added in the 2026 redesign:

```css
--row-height-shell: 44px;
--cell-pad-x-shell: 16px;
--radius-control:    7px;   /* rail items, chips, section cards */
--radius-input:      8px;   /* inputs, buttons */
--radius-card:       9px;   /* cards inside a build-up */
--radius-panel:     12px;   /* panels */
--panel-highlight:  inset 0 1px 0 rgba(255,255,255,0.035);
```

| | Dense | Shell |
|---|---|---|
| Rows | 32px | 44px |
| Panel radius | 4px | 12px |
| Used by | Rate Desk, Catalogue, Price Watch, Vocabulary, Coverage, History, Quotes list | Inbox, Quote detail |

**The distinction is what a row is.** On a dense screen a row is a *record* in
a list of many — the Rate Desk shows 167, the Catalogue 99 — and a third fewer
rows per screen is a cost paid by whoever is reading them. On the Inbox a row
is a *thing you act on*, a dozen of them, and the height is what makes the
Match column and the two-line Quoted cell legible.

Opt in per screen, never globally: `<Panel scale="shell">`, `<DataTable
scale="shell">`, `<ExpandableRow scale="shell">`. A screen that does not ask
gets the dense scale, which is the right default for a screen nobody has
thought about yet.

The `radius ≤ 4px` rule below still holds on the dense scale. It was written
when every screen was a table; the shell scale is the exception, and it is an
exception with a name rather than a drift.

**Depth is still never a drop shadow.** The shell scale adds one 1px inner top
highlight on a panel and an inset surface behind table headers and footers.
`--shadow-popover` remains the only shadow in the app.

**Space groups, it does not fill.** A panel's internal padding is `--space-4`; the gap *between* related rows is 0 (they share a hairline); the gap between unrelated panels is `--space-5`. Generous space around numbers means the number has room to breathe within its cell — not that the table is loose.

**Layout shell:** a fixed 200px left rail (navigation, no icons-only mode — labels always visible), fluid content, and an optional 320px right rail for totals, provenance, or audit. Content max-width is unconstrained; this is a terminal, and a costing engineer with a 32" monitor should get 32" of columns.

---

## 5. Components

Built on Radix primitives for keyboard and ARIA behaviour; every visual property comes from tokens above.

| Component | Notes |
|---|---|
| `Panel` | Hairline border, `--radius-lg`, `--surface-panel`. No shadow, no gradient. Optional title row with a `--line-strong` underline. |
| `DataTable` | Virtualised. Sticky header in `--surface-panel` with a `--line-strong` underline. Rows separated by `--line-hairline`. Hover `--surface-hover`. Selection `--surface-selected`. Column widths reserved so refresh causes no shift. |
| `ExpandableRow` | **The signature.** §6. |
| `StatusDot` | 6px. `solid` \| `hollow` per tier. Always paired with its word. Single source of tier meaning. |
| `NumericCell` | Owns every formatting rule in §3. Takes a `Decimal`, a unit, and a precision. Cannot be passed a pre-formatted string. |
| `Field` | Label above (`label` token), value below. Inline edit on click for editable rates; commits on `Enter`, reverts on `Escape`. |
| `ConfirmBar` | Replaces modals for consequential actions. Slides up from the bottom edge, states the blast radius in words — *"Reprice 99 products and flag 3 open quotes?"* — with cancel and a copper confirm. Blocks nothing else on screen. |
| `Drawer` | Right side, 400px, `--surface-raised`. Audit trails and provenance. Never nests. |
| `CommandPalette` | `⌘K`. Jump to product, customer, job, quote; run a rate edit; open a quote. The primary navigation for a power user. |
| `AuditTrail` | Reverse-chronological mono list: `24 Jul 14:20 · B. Patolia · LME 9,180.00 → 9,340.00`. Same component for rates, overrides, and approvals. |
| `Toast` | Bottom-left, hairline border, no icon, auto-dismiss 4s. Errors persist until dismissed. |
| `Legend` | The tier legend, rendered from the same tier definitions as `StatusDot` so they cannot drift apart. |

**No component may introduce a colour, radius, duration, or font size that isn't a token.** Enforced by lint rule against raw hex values, `px` radii, and `ms` durations in component files.

---

## 6. The signature: the expandable cost line

> *A simple price on the surface, complete traceability one click beneath.*

This interaction is the product in miniature and gets more care than anything else in the app.

### Collapsed

A single clean row on the base surface. Chevron in `--ink-tertiary`, designation in `--ink-primary`, quantity and price in `numeric`. Row height 32px. Nothing suggests there's more beneath except the chevron.

```
▸  4C × 50mm² Cu XLPE SWA PVC 0.6/1kV        12,000 m      4.812      57,744.00
```

### Expanding

The row opens **downward, in place**. The page does not navigate, the row does not become a modal, and the surrounding rows keep their positions relative to it.

- Interior surface steps to `--surface-raised` — one shade, no border, so the expansion reads as *inside* the row rather than *on top of* it.
- The interior is inset `--space-4` from the left, aligning its first column under the parent's designation. The nesting is legible from alignment alone.
- Section rows (Materials, Machine operations, Overheads, Commercial) are themselves expandable — **depth three, all in place**.
- Every leaf line ends in a provenance affordance: the rate it used and its effective date, in `micro` mono, `--ink-tertiary`.
- The breakdown footer states the strike: `Struck on LME 9,340.00 · FX 0.3845 · 24 Jul 2026 14:20 GST`.

```
▾  4C × 50mm² Cu XLPE SWA PVC 0.6/1kV        12,000 m      4.812      57,744.00
   ┌─────────────────────────────────────────────────────────────────────────
   │ ▾ Materials                                                  2,847.312
   │     Copper conductor        684.000 kg/km   2.0%   697.680   3.284   2,291.18
   │       └ material_rate #12 · effective 24 Jul 2026 · LME-linked
   │     XLPE insulation         142.000 kg/km   3.0%   146.260   1.180     172.59
   │     Galvanised steel wire   412.000 kg/km   2.5%   422.300   0.680     287.16
   │     PVC sheath              186.000 kg/km   3.0%   191.580   0.510      97.71
   │ ▸ Machine operations                                            612.480
   │ ▸ Overheads & tooling                                           188.000
   │ ─────────────────────────────────────────────────────────────────────────
   │   Cost per km                                                 3,647.792  OMR/km
   │   Cost per metre                                                 3.6478  OMR/m
   │ ▸ Commercial — margin 24.0% · drum · packing · freight
   │ ─────────────────────────────────────────────────────────────────────────
   │   Unit rate                                                       4.812  OMR/m
   └─ Struck on LME 9,340.00 · FX 0.3845 · 24 Jul 2026 14:20 GST
```

### Rules

1. **Never a modal, never a navigation.** The engineer never loses their place.
2. **The breakdown ships with the row.** Server-rendered alongside it, not fetched on click. There is no loading state, because there is no load. This is what makes it feel like an instrument rather than a web page.
3. **One component everywhere.** Product detail, quote builder, review screen, and history all use the same `ExpandableRow`. No variants. If it looks different in two places, they've drifted.
4. **Expansion state persists** across sort, filter, and page reload, keyed by line id.
5. **Every leaf is auditable.** A test walks the rendered tree and asserts every terminal number carries a provenance reference. A number with no origin is a build failure.

### Motion

```css
--ease-expand: cubic-bezier(0.2, 0, 0, 1);
--duration-expand: 140ms;
--duration-tick: 600ms;
```

Height and opacity only, 140ms, on the `--ease-expand` curve. No slide, no scale, no bounce, no stagger. Under `prefers-reduced-motion`, expansion is instantaneous and nothing is lost.

---

## 7. The copper tick

The one other moving thing in the app.

When the LME price updates, the digit block flashes `--copper-wash` behind it and fades over `--duration-tick`. **The number does not move, slide, count, or roll.** The flash draws the eye; the value is readable throughout.

If the new value is materially different from the last, the delta appears beside it in `micro` mono for 6 seconds, then fades: `+160.00 since 08:00`. It does not persist — a permanent delta would be a second thing competing for attention on a screen whose whole discipline is having one.

---

## 8. Keyboard

A costing engineer lives in this screen all day. Mouse-optional is a feature, not an accessibility footnote.

| Key | Action |
|---|---|
| `⌘K` | Command palette |
| `/` | Focus search |
| `j` / `k` | Row down / up |
| `Space` | Expand / collapse focused row |
| `⇧Space` | Expand focused row and all its sections |
| `Enter` | Open focused item |
| `e` | Edit focused rate (Rate Owner) |
| `o` | Override focused line (Engineer) |
| `Escape` | Collapse, close drawer, revert inline edit |
| `⌘Enter` | Commit the screen's primary action |

Focus is a 1px `--line-focus` ring at `--radius-sm`, offset 1px. It is always visible on keyboard focus and never suppressed.

---

## 9. Writing

The interface's voice is part of the instrument.

- **State facts, not feelings.** `Aluminium conductor — library is copper only`. Not *"Sorry, we couldn't find a match!"*
- **Name the consequence before the action.** `Reprice 99 products and flag 3 open quotes?`
- **Never disable silently.** A disabled action always states its condition: `Approve — 3 lines still need pricing`.
- **Numbers in prose are mono too.** *"3 open quotes were priced at `LME 9,340`. Copper is now `9,720`."*
- **No exclamation marks. No emoji. No first person.** The app doesn't have feelings about your margin.
- **Timestamps are absolute, with timezone.** `24 Jul 2026 14:20 GST`, never *"2 hours ago"*. An engineer reconstructing a quote needs the actual time.

---

## 10. What would break this

A short list of the specific things that would make it stop reading as an instrument. Treated as review criteria on every pull request.

- A second decorative colour anywhere.
- A coloured button that isn't the one copper primary action.
- Numbers in a proportional font — anywhere, including tooltips and PDFs.
- A card with a shadow.
- A modal where an inline expansion or a confirm bar would do.
- A loading spinner on a row expansion.
- Any animation with easing that overshoots.
- A radius above 4px.
- A status colour used for something that isn't a match tier.
- Relative timestamps.
