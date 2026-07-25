# Cable Quoting App — Phased Build Plan

**Nuhas Oman LLC** · Planning document · v1

Companion documents:
- [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) — the visual and interaction system (the "instrument" look)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — code structure, scalability, and the rules that keep it maintainable

---

## 0. How this plan is organised

The specification defines four build phases. This plan adds a **Phase 0** (foundation) in front of them, because both the premium UI and the scalability of the codebase are decided in the first two weeks or not at all. Retrofitting a design system onto twenty screens costs more than the screens did.

Each phase below has the same shape:

| Section | What it answers |
|---|---|
| Objective | What is true at the end that wasn't true at the start |
| In scope / Out of scope | The boundary, stated so it can't drift |
| Screens | What gets built, and how it looks and behaves |
| Data & logic | Schema additions and the engine work |
| Acceptance criteria | Testable statements — the phase is done when all pass |
| Demo script | The five minutes shown to the CEO to release the next phase |
| Risks | What could go wrong and the mitigation |
| Exit gate | The hard condition for starting the next phase |

**Sequencing rule:** no phase starts until the previous phase's exit gate passes in production with real users. The spec's instinct — *"each phase works on its own and earns its keep"* — is the single most valuable constraint here and is treated as binding.

---

## 1. Recommended stack

Chosen for: dense data UI, exact decimal arithmetic, small team, and the ability to grow from 99 products to 10,000 without a rewrite.

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript, strict** | Server components render dense tables without shipping the data twice; one deployable; Server Actions remove a hand-written API layer for internal tools |
| Database | **PostgreSQL** | `NUMERIC` for exact money, range types and exclusion constraints for effective-dated rates, JSONB for frozen cost snapshots |
| ORM | **Prisma** (or Drizzle) | Typed schema, migrations as reviewable SQL |
| Money | **decimal.js** end to end, unconstrained `NUMERIC` in Postgres, read back via `::text` | Floats are disqualified. A 0.0001 OMR/m error over 40 km of cable is real money. A *fixed scale* is disqualified too — measured against the real cost master, `NUMERIC(18,6)` alters 53.7% of imported values |
| UI | **Tailwind v4** with a token layer + **Radix primitives** (unstyled) | Radix gives keyboard and ARIA behaviour; all visuals come from our tokens, so nothing looks like a component library |
| Tables | **TanStack Table + TanStack Virtual** | Headless. Expandable rows, column sizing, and virtualisation at 10k rows are solved problems |
| Charts | None in v1 | The spec is right: this is a ledger, not a dashboard |
| Background work | **pg-boss** (Postgres-backed queue) | Mail polling, extraction, price-watch sweeps. No extra infrastructure until volume demands it |
| Auth | **Auth.js** with email/OIDC, 3 roles | Rate Owner, Engineer, Viewer |
| Testing | Vitest (unit), Playwright (e2e), plus a **golden-parity harness** (see Phase 1) | The parity harness is the most important test asset in the project |
| Hosting | Single container + managed Postgres | ~10 internal users. Anything larger is premature |

**Deliberate non-choices:** no microservices, no GraphQL, no client-state library, no component kit with its own visual opinions, no charting library, no animation library beyond CSS transitions.

---

## 2. Cross-cutting foundations

These are built in Phase 0 and every later phase depends on them.

### 2.1 Exactness and rounding

One policy, written once, enforced by the type system:

- All internal arithmetic in `Decimal`, 6 decimal places, **no intermediate rounding**.
- Rounding happens **only at the display and document boundary**:
  - cost per km → 3 dp
  - cost per metre → 4 dp
  - unit rate (OMR/m) → 3 dp
  - line total and quote total → 2 dp
- Rounding mode: half-up, stated in the UI footnote of every breakdown.
- The `Money` and `Rate` types are branded — a raw `number` cannot reach the cost engine without a compile error.

### 2.2 Effective dating and reconstruction

Every rate table row carries `valid_from` / `valid_to`. Postgres exclusion constraints prevent overlapping periods for the same key.

Reconstruction uses **belt and braces**:
1. A quote stores `priced_at` — the engine can re-resolve rates as of that instant, and
2. A quote stores the **full frozen cost breakdown as JSONB** — the exact inputs and outputs at approval time.

Either alone is insufficient. (1) breaks if history is ever corrected; (2) alone can't explain *which rate row* a number came from. Together, the answer to *"why was this 4.812 OMR/m in March?"* is one click and cannot drift.

### 2.3 Audit log

Append-only `audit_event` table. Every rate change, override, approval, and dictionary addition writes `{actor, entity, field, old_value, new_value, reason, at}`. No hard deletes anywhere in the system — only `valid_to` closure and soft-delete flags.

### 2.4 Roles

| Role | Can |
|---|---|
| **Rate Owner** (one named person) | Edit rates, margins, dictionary, product library |
| **Engineer** | Review jobs, override with reason, approve, send |
| **Viewer** (CEO) | Read everything, including every breakdown and the audit trail |

Approval and rate editing are deliberately separate people. The spec's ask for "one named owner for the rate table" is enforced in code, not policy.

### 2.5 Performance budgets

Held from Phase 0 and asserted in CI:

- Inbox and review tables interactive in **< 200 ms** at 1,000 rows (virtualised).
- Row expand → breakdown painted in **< 100 ms** (breakdown is server-rendered with the row, not fetched on click).
- Full quote recost on an LME change: **< 500 ms** for 200 lines.
- No layout shift on data refresh — reserved column widths, no skeleton pop.

---

## Phase 0 — Foundation, design system, and the parity harness

**Duration:** 2 weeks · **Prerequisite:** the 99 costed spreadsheets, the 133 material rates, the 34 machine rates

### Objective
The token system, the primitive components, the decimal spine, and the spreadsheet-parity test harness all exist, so Phase 1 is business logic only and Phase 1's UI is assembly rather than invention.

### In scope
- Repo, CI (typecheck, lint, unit, e2e, a11y contrast check), preview deploys
- Design tokens as CSS custom properties + Tailwind theme (see `DESIGN_SYSTEM.md` §2)
- Type system loaded and metric-checked; **numeric font locked with tabular figures and slashed zero**
- Primitive components: `Panel`, `DataTable` (virtualised, expandable), `StatusDot`, `NumericCell`, `Field`, `Drawer`, `CommandPalette`, `ConfirmBar`, `AuditTrail`
- A **component gallery route** (`/_dev/gallery`) showing every primitive in every state — this is the design review surface for the whole project
- `Decimal` spine, branded money types, rounding policy module
- Schema for rates, materials, machines, products, BOM lines, audit
- **Data import**: the 99 spreadsheets parsed into the product/BOM tables, with a report on every cell that didn't map cleanly
- **The parity harness**: for each of the 99 products, the spreadsheet's own answer is stored as a golden fixture. A test recomputes each product from the imported tables and asserts a match.

### Out of scope
Any screen a user sees.

### Acceptance criteria
1. `pnpm test` runs the parity harness; the report lists per-product pass/fail (failures are expected at this stage — the harness existing is the deliverable).
2. Gallery renders every primitive; contrast check passes for all token pairs at their intended sizes.
3. A numeric column of 200 mixed-magnitude values aligns on the decimal with zero pixel drift at 13px.
4. Import report accounts for **every** cell in all 99 sheets: mapped, ignored-by-rule, or flagged.

### Risks
| Risk | Mitigation |
|---|---|
| The 8 hand-entered overhead lines per product follow no formula | Import them as opaque per-product constants now. The overheads *rule* is only needed for new products (Phase 4) — flag it to Nuhas early but don't block on it |
| Licensed display/mono fonts (Neue Haas, Söhne, Berkeley Mono) unavailable | Ship on open equivalents with identical metrics behaviour (see `DESIGN_SYSTEM.md` §3); swapping later is a token change, not a refactor |
| Spreadsheets are an old export | Confirm currency with Nuhas **before** import, not after (spec Part 5) |

### Exit gate
Harness runs, gallery approved by the engineer and the CEO on a real screen — not a mockup image.

---

## Phase 1 — Reprice the existing products

**Duration:** 4 weeks · *"This is where the money is."*

### Objective
An engineer picks a product, enters a quantity, and gets a correct price on today's copper — with the full build-up visible. Stale copper pricing is fixed on the day this ships.

### In scope
- Rate management (LME, FX, 133 materials, 34 machines, overheads, margin)
- Cost engine, complete and pure
- Product catalogue browse and search
- Single-product and multi-line manual quote building
- Quote generation to PDF and Excel
- Live price watch over quotes created here
- Full history and re-quote

### Out of scope
Matching, review tiers, document reading, email.

### Screens

**1. Rate Desk** — the Rate Owner's home.
Left rail: rate families (Copper & FX · Materials · Machines · Overheads · Margins). Right: a dense editable table.
The copper block sits at the top as the app's only coloured element: `LME 9,340.00 USD/t` in copper at display size, with `FX 0.3845` and the derived `OMR/kg` beneath it in muted mono. Editing LME opens an inline confirm bar — *"Reprice 99 products and flag 3 open quotes?"* — never a modal.
Every row carries an inline history affordance: hover reveals a small mono `↩` that opens the audit trail for that single rate in a right drawer.

**2. Product Catalogue**
A virtualised table of the 99 products: designation, cores, size, voltage, construction summary, current cost/m, last repriced. Filter chips along the top in muted grey; the active filter is the only one with a hairline copper underline. `/` focuses search, `j`/`k` move, `Enter` opens.

**3. Product Detail — the signature screen**
Header: designation at display size, construction as a row of monospace key–value pairs. Then the **cost build-up as a set of expandable sections**, not tabs:

```
▸ Materials                                    2,847.312  OMR/km
▸ Machine operations                             612.480  OMR/km
▸ Overheads & tooling                            188.000  OMR/km
─────────────────────────────────────────────────────────────────
  Cost per km                                  3,647.792  OMR/km
  Cost per metre                                   3.6478 OMR/m
▸ Commercial (margin, drum, packing, freight)
─────────────────────────────────────────────────────────────────
  Unit rate                                        4.812  OMR/m
```

Expanding Materials unfolds in place into every material line: name, kg/km, scrap %, effective kg, rate, extended cost — six aligned monospace columns, hairline rules, no card, no shadow. Expanding a *material* row once more shows which rate row and effective date it drew from. Depth is three levels and every level is in place; the engineer never navigates away.

The footer of every breakdown states the strike: `Struck on LME 9,340.00 · FX 0.3845 · 24 Jul 2026 14:20 GST`.

**4. Quote Builder**
Add products, set quantities and terms. Each line is the collapsed signature row; each expands into the same build-up. Right rail holds totals, validity, delivery terms, and the single copper `Generate quote` button — the only saturated element on screen.

**5. Quote History & Live Price Watch**
One table of every quote: customer, date, value, LME struck, expiry, drift. The drift column is the only place a status colour appears here — quiet green within threshold, amber past it. A row expands to show the affected lines and a `Re-quote on today's rates` action that clones rather than mutates.

### Data & logic

```
material_rate, machine_rate, overhead_line, margin_rule   (all effective-dated)
lme_price, fx_rate                                        (time series)
product → bom_line[] → material_rate
        → machine_op[] → machine_rate
        → overhead_line[]
quote → quote_line → cost_snapshot (JSONB)
audit_event
```

**The cost engine is a pure function** and this is the single most important engineering decision in the project:

```ts
computeCost(
  product: Product,
  quantity: Quantity,
  rates: ResolvedRateSet,     // already resolved as of an instant
  terms: CommercialTerms,
) : CostBreakdown              // a tree, not a number
```

No I/O, no clock, no database access, no framework imports. It returns the whole tree — every material, every machine stage, every overhead, each with its inputs — because the UI's signature interaction needs the tree anyway and computing it twice would let the summary and the detail disagree. **The number shown and the number explained are the same object.**

Copper: `OMR/kg = LME_USD_per_tonne × FX ÷ 1000 + drawing_premium(size)`, with `drawing_premium` a per-size table, not a constant. FX default 0.3845, editable, effective-dated. **This formula is flagged in the UI as "assumed, pending confirmation" until Nuhas confirms it** (spec Part 5) — a small amber note under the copper block, removed by a config flag on confirmation.

### Acceptance criteria
1. **All 99 products reproduce their spreadsheet value exactly at 4 dp** when fed the spreadsheet's own LME and FX. Any product that cannot is documented with the reason before sign-off.
2. Changing LME and saving reprices all 99 in < 500 ms and writes one audit event with the previous value.
3. Every number on a Product Detail screen is reachable by expansion down to a rate row with an effective date. Zero exceptions — this is checked by a test that walks the breakdown tree and asserts every leaf has provenance.
4. PDF and Excel exports carry line items, unit rates, quantities, totals, terms, validity, and the LME/FX strike.
5. A quote approved on Monday renders identically on Friday after three rate changes.
6. Keyboard-only path from inbox to generated quote, no mouse.

### Demo script
Open Rate Desk → type this morning's LME → confirm bar shows the blast radius → save → open a product → the cost/m has moved → expand Materials → expand copper conductor → see the new rate and its effective date → build a 2-line quote → export PDF → open Price Watch and see two older quotes now flagged amber.

### Risks
| Risk | Mitigation |
|---|---|
| Parity failures on a handful of products | Timeboxed: any product that fails is quarantined with a visible "not repriced — manual" badge rather than shipped wrong. The spec's rule holds: if it isn't confident, it doesn't price |
| The copper formula is wrong | The whole formula is one module with one test file; a correction is a one-line change plus a re-run of the harness |
| Margin varies by customer in ways the sheets don't capture | Margin rules are a first-class table (by family, by customer, by both) from day one |

### Exit gate
An engineer has used it to send a real quote to a real customer.

---

## Phase 1.5 — Copper pricing basis *(added after Nuhas described how they actually price)*

**Duration:** ~2 weeks · **Prerequisite:** the write path, and a sample of the copper purchase-order export

### Why this exists

The app currently assumes one copper basis: today's LME. That is not how Nuhas
prices. They pre-book copper in quantity, and normally charge the **weighted
average of what they actually paid**; a large order is priced at **live LME**
instead, because it exceeds what is on the books.

Both are legitimate. Neither is a rounding detail — copper is the majority of a
cable's cost, so the basis chosen moves the whole quote.

### Objective

The engineer chooses, per quote, how copper is charged, and can see what the
other basis would have given.

### In scope

- **Import the copper purchase ledger** from Nuhas's own export: quantity,
  price paid, order date, and whether the lot is **delivered or still pending**
- **Three bases**, selected per quote:
  - **Booked average** — weighted mean of the lots in scope
  - **Live LME** — as today
  - **Blended** — the covered portion at booked average, the uncovered
    remainder at live LME
- Delivered-only versus delivered-plus-pending as a **visible toggle**, never a
  buried assumption
- Every quote records which basis it was struck on, alongside the LME stamp it
  already carries

### The blended basis, and why it is the sharper form of Nuhas's own rule

"Big order → live price" is a proxy for *"this order needs more copper than I
have booked."* Blending states that precisely: 40 t booked against a 65 t
order prices 40 t at cost and 25 t at market. Same intent, no cliff edge at
whatever counts as "big", and the engineer can see exactly where the line falls.

### The question that must be answered before this is trustworthy

**Does booked copper deplete as quotes are written against it?** If two quotes
both price off the same 40 t, the same cheap copper has been sold twice and the
second quote is understated. A booking ledger without allocation is a
half-truth that drifts further from reality as the order book fills.

Tracking consumption is materially more work — it makes the ledger stateful and
raises questions about what happens when a quote lapses. It is called out here
so the choice is deliberate rather than discovered later.

### Effect on price watch

Exposure stops being "LME has moved since you quoted" and becomes "what
replacing this copper actually costs" — the number that decides whether an open
quote is still worth honouring.

### Acceptance criteria

1. The purchase-order export imports with the same every-cell-accounted-for
   report the cost master import produces.
2. A quote priced on booked average, live LME, and blended produces three
   different, individually explainable numbers, each fully expandable.
3. **Live LME remains the default**, so all 99 products keep reproducing their
   source sheets and the parity harness is untouched.
4. Changing basis is an audited decision, attributed to a person.

### Risk

| Risk | Mitigation |
|---|---|
| The export's real columns differ from what was assumed | Do not build until a real export has been read. The cost-master import proved the point: three assumptions taken from the spec were wrong, and only the actual file revealed it |
| Booked average silently drifts as stock is consumed | Answer the allocation question above before this is used on a real quote |

---

## Phase 2 — Matching and review

**Duration:** 4 weeks

### Objective
An engineer pastes an RFQ line as free text; the app normalises it, matches it to the library, tiers it, prices what it can, and presents a review screen where the whole job is approved in one pass.

### In scope
Vocabulary normalisation and dictionary; the four-tier matcher; the review screen; override with reason; save-back to library; job status flow (Ready for review → Approved → Sent).

### Out of scope
Reading documents. Input is paste-a-line or paste-a-block.

### Screens

**1. Paste & Parse**
A single wide monospace textarea. Paste multiple lines; each becomes a job line. The left half keeps the raw text; the right half fills with the parsed fields as they resolve. Unresolved fields are empty with a hairline amber underline — **never a guess**.

**2. Vocabulary**
The dictionary the Rate Owner edits: canonical term, synonyms, times seen, last seen, which customer. When an unknown term pauses a job, resolving it here writes the answer back and the paused job resumes. A "learned this month" view makes the spec's *"stops asking after the first months"* visible and measurable.

**3. Review — the workhorse**
One row per line. Columns: status dot, customer text (truncated, full on hover), matched product, quantity, unit rate, line total. Sorted red → amber → green by default, because the engineer's time goes to red.

- **Exact** — solid green dot, priced.
- **Close** — solid amber dot, priced on the substituted material, with the substitution named inline: `LSOH ← PVC sheath`.
- **Partial** — hollow red dot, **no price**. Expands to show the three nearest products with their costs and exactly which field differs.
- **No match** — solid red dot, the reason stated in words: `Aluminium conductor — library is copper only`.

Fill versus outline distinguishes the four tiers without introducing a fourth colour. The dot means the same thing on the inbox, the review screen, and the quote — one component, one legend.

Expanding any priced row gives the identical Phase 1 build-up. Same component, no variant.

Override: click the rate, type the new one, a reason is **required** before it commits, and the row gains a small mono `M` marker that persists onto the quote and into history. A manually costed cable offers `Save to library` — which drops into the Phase 1 product form pre-filled.

The approve action is disabled with a stated reason until every line is green, amber, or explicitly overridden — the button never simply sits grey and silent.

### Data & logic

```
job → job_line → { raw_text, extracted: JSONB, normalised: JSONB, match_result, override }
vocabulary_term → synonym[]
match_rule, substitution_rule
```

**Matching is deterministic. No model, no scoring heuristic, no fuzzy threshold in the pricing path.** The canonical key is eight fields: cores, size, conductor, insulation, armour, sheath, voltage, standard.

- All eight equal → **Exact**
- Exactly one differs, that field is on the **safe-substitution allowlist**, and the substitute material has a rate → **Close**, recosted, flagged
- A core parameter differs (cores, size, voltage) → **Partial**, unpriced, nearest three shown by a declared distance metric
- Conductor ≠ copper, voltage outside the held set, or unknown standard → **No match**, reason stated

The allowlist is data, owned by the Rate Owner, not code.

**Validation gate** before any price is shown: physical plausibility bounds per (cores × size) on weight/km, and a price-band check against the family's historical range. A line failing either is held for review regardless of tier — a 3-core 50 mm² cable that comes out at 4,000 kg/km is rejected, exactly as the spec requires.

### Acceptance criteria
1. A 20-line pasted RFQ tiers correctly against a hand-marked expected set.
2. No Partial or No-match line can ever carry a price — asserted at the type level (an unpriced line has no price field to render, not a null one).
3. Every override has a reason; overrides survive into export and history.
4. An unknown term pauses exactly one job line, not the job, and resolving it resumes it.
5. Save-back creates a product that the Phase 1 parity harness then covers.

### Risks
| Risk | Mitigation |
|---|---|
| Substitution allowlist too permissive → wrong prices | Starts nearly empty. One entry (PVC↔LSOH sheath). Grows only on the Rate Owner's explicit decision, each addition audited |
| Engineers override constantly, meaning the matcher isn't trusted | Override rate is a tracked metric on the review screen; a rising rate is a product signal, not a UI problem |

### Exit gate
An engineer processes a week of real RFQ lines by paste, faster than by spreadsheet, with zero wrong prices reaching a customer.

---

## Phase 3 — Document reading

**Duration:** 5 weeks

### Objective
An RFQ email with an attachment becomes a job with extracted lines, with every field traceable to where it came from in the document — feeding Phase 2 untouched.

### In scope
Mailbox watching, drag-and-drop upload, digital PDF and Excel extraction, the side-by-side provenance view, the unreadable path, the inbox.

### Out of scope
OCR, handwriting, photographs. **By design** — the spec is explicit and correct: *"the app says 'I can't read this' rather than reading it badly."*

### Screens

**1. Inbox** — the app's new home screen.
Rows: customer, received, line count, total value, status. Status is a word plus a dot, never a coloured pill. `Reading` shows a single quiet dot that pulses once per second — the only animation in the app besides row expansion and the copper tick. Filters (status, customer, date range) as muted chips; badge count for jobs awaiting the engineer sits in the rail as a small mono number, no red circle.

**2. Extraction Review — split view**
Left: the original document rendered page by page. Right: the extracted lines. Selecting a line **highlights its source region in the document** with a thin copper rule down the left of the source text; selecting a source region scrolls to its line. This is where the trust is won — the engineer sees where every number came from without opening the attachment separately.

Unreadable documents don't reach this screen. They land in the inbox with `Unreadable — scanned document` and a direct path to manual entry. The failure is stated plainly and immediately; no spinner, no partial extraction.

### Data & logic

```
mailbox_poll → message → attachment → document → extraction_run → extracted_line
extracted_line.provenance = { page, bbox, source_text, confidence }
```

Pipeline:
1. **Readability check first.** Text-layer density below a threshold → `unreadable`, routed to the engineer, pipeline stops. No OCR fallback.
2. **Excel:** deterministic table extraction; header inference against known column vocabularies.
3. **PDF:** layout-aware text extraction, then a **constrained structured-output LLM call per table region** with a strict schema. The prompt's controlling rule: *any field you are not certain of, return null.* No free-text output, no reasoning in the output path.
4. **Every field carries provenance** — page, bounding box, and the exact source substring.
5. Output flows into Phase 2's normaliser. **Phase 2 is not modified.** If it were, the phase boundary would have been drawn wrong.

The model never touches pricing, never touches matching, and never fills a field it isn't certain of. It converts layout into candidate fields; determinism resumes immediately after.

### Acceptance criteria
1. Against the 20–30 real RFQs from Nuhas: **precision on extracted fields is the metric that matters, not recall.** An empty flagged field is a success; a wrong field is a failure. Target: zero wrong fields, missing fields acceptable.
2. Every scanned or photographed document is correctly classified unreadable — no false "readable".
3. Every extracted field highlights its source on click.
4. Mailbox outage degrades to drag-and-drop with a visible banner; no silent loss. Attachments are content-hashed so a re-poll never duplicates a job.

### Risks
| Risk | Mitigation |
|---|---|
| Real RFQs are messier than the sample | Phase 3 ships behind a per-customer flag; enable customer by customer as extraction is proven on their format |
| Extraction cost or latency | Per-region calls are cached by content hash; a re-run of an unchanged document costs nothing |
| Mailbox credentials/security | Read-only scope, one dedicated mailbox, attachments scanned and stored in object storage with no execution path |

### Exit gate
Three consecutive weeks where every RFQ into the watched mailbox produced either a correct extraction or an honest "unreadable", with no wrong field reaching an engineer unflagged.

---

## Phase 4 — Costing outside the library *(conditional)*

**Duration:** 6+ weeks · **Do not start** without evidence

### Trigger condition
This phase is justified only if, after a full quarter of Phase 3 in production, **Partial and No-match lines exceed a threshold Nuhas agrees in advance** (suggested: >15% of line volume, or >20% of quoted value). If the library covers the demand, this phase is never built. That decision is data, not opinion — the review screen tracks tier distribution from Phase 2 onward precisely so this call can be made on evidence.

### Objective
Construct a bill of materials for a cable that isn't in the library, from IEC 60502 construction rules, and cost it through the existing engine.

### Scope
Geometric construction model (conductor stranding, insulation thickness by voltage, bedding, armour wire count and diameter, sheath thickness), material weight derivation, machine-stage inference, and the agreed overhead basis.

### The gate that matters
**Validation against the existing 99.** The construction model must reproduce the BOM of all 99 known products from their specifications alone, within an agreed tolerance, before it is allowed to price a single unknown cable. A model that cannot re-derive what we already know cannot be trusted on what we don't.

Constructed cables are visually distinct everywhere they appear — a `derived` marker beside the designation — and are never auto-approved. They always require engineer sign-off, whatever the confidence.

### Prerequisite from Nuhas
The overheads rule (percent of raw material, per machine hour, or per family). Phase 4 cannot start without it — this is the one Part 5 item that is a hard blocker rather than a flag.

---

## 3. Timeline

```
Week   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
      ├───────┤
      Phase 0 (foundation, design system, parity harness)
              ├───────────────┤
              Phase 1 (rates, engine, quotes)          ← ships value here
                              ├───────────────┤
                              Phase 2 (matching, review)
                                              ├───────────────────┤
                                              Phase 3 (documents)
                                                                   ┆ Phase 4 — only on evidence
```

**15 weeks to full scope**, with production value from **week 6**. Assumes one full-stack engineer with design review at each phase gate. A second engineer parallelises Phase 2 and 3 to roughly 12 weeks; it does not shorten Phase 0 or 1, which are sequential by nature.

---

## 4. What is needed from Nuhas, by when

| Need | Needed by | Blocking? | If not provided |
|---|---|---|---|
| Confirmation the 99 sheets are current | **Before Phase 0 import** | **Yes** | Everything downstream is built on stale data |
| One named rate owner | Phase 1 start | **Yes** | Rate governance has no accountable person; the app becomes a spreadsheet with extra steps |
| Confirmation of the copper formula (LME × FX ÷ 1000 + drawing premium, FX 0.3845) | Phase 1 sign-off | No | Ships with a visible "assumed" flag on every quote; one-module fix on confirmation |
| 20–30 real RFQs | Phase 3 start | **Yes** | Extraction cannot be validated; phase does not start |
| Overheads rule for new products | Phase 4 start only | No (until Phase 4) | Existing products are unaffected — theirs are stored |

---

## 5. Success measures

Tracked from the first phase that can produce them, and visible in the app rather than in a report:

- **Quote turnaround** — RFQ received to quote sent. The headline number.
- **Copper staleness** — hours between LME publication and the app repricing. Target: under one working day, and this alone justifies Phase 1.
- **Auto-priced share** — percent of lines priced without engineer intervention. Rising is good; the tier mix tells you where the library needs to grow.
- **Override rate** — percent of auto-priced lines the engineer changed. Should fall toward zero. If it doesn't, the matcher or the rates are wrong, and that is worth knowing early.
- **Wrong prices sent** — target zero, permanently. Every other metric is subordinate to this one. The system is built so its failure mode is refusing to answer.
