# Architecture — Built to Stay Changeable

**Cable Quoting App · Nuhas Oman LLC**

The app starts at 99 products and ~10 users. It has to survive 10,000 products, a decade of rate history, a rules engine it doesn't have yet, and a team that isn't the team that built it. Scalability here means **the cost of the next change stays flat** — not requests per second.

---

## 1. The layering rule

Four layers. Dependencies point **inward only**. A violation is a build failure, not a code review comment.

```
   app/          Next.js routes, server actions, React components
     │                    ↓ depends on
   modules/      Business logic, per domain — the app's actual value
     │                    ↓ depends on
   core/         Decimal, Money, Result, Id, branded types, errors
                          ↑ depends on nothing

   infra/        Prisma, mail, storage, LLM client, PDF/Excel writers
                 Implements ports declared in modules/. Depended on by
                 nobody — it is injected at the composition root.
```

**`core/` imports nothing.** Not React, not Prisma, not Next. It is the vocabulary every other layer speaks.

**`modules/` imports only `core/` and other modules' public APIs.** No `import { prisma }`, no `next/*`, no React. This is what makes the cost engine testable in microseconds and portable to a background worker, a CLI, or a future API without moving a line.

Enforced by `dependency-cruiser` in CI:

```js
{ name: 'core-imports-nothing',      from: { path: '^src/core' },    to: { pathNot: '^src/core' } },
{ name: 'modules-are-pure',          from: { path: '^src/modules' }, to: { path: '^(src/app|src/infra|node_modules/(next|react|@prisma))' } },
{ name: 'no-cross-module-internals', from: { path: '^src/modules/([^/]+)' }, to: { path: '^src/modules/(?!$1)[^/]+/(?!index)' } },
```

That third rule is the one that matters at year three: modules talk to each other **only through their `index.ts`**. Reaching into another module's internals is how a codebase seizes up.

---

## 2. Module map

Each is a bounded context with its own types, its own public API, and no shared "utils" dumping ground.

```
src/modules/
  rates/        Effective-dated rate resolution, LME, FX, audit of changes
  costing/      The cost engine. Pure. The crown jewel.
  catalogue/    Products, BOM, machine ops, overheads
  matching/     Normalisation, dictionary, the four tiers      [Phase 2]
  quoting/      Quotes, lines, overrides, approval, documents
  extraction/   Readability check, PDF/Excel → candidate fields [Phase 3]
  jobs/         Inbox, job lifecycle, status                    [Phase 3]
  pricewatch/   Drift detection over open quotes
  audit/        Append-only event log, used by all of the above
```

**Later phases add modules; they don't modify earlier ones.** Phase 3's `extraction` produces the same shape `matching` already consumes from pasted text — so Phase 2 is untouched when Phase 3 lands. If a later phase forces edits to an earlier module's core, the boundary was drawn wrong and that's the signal to stop and redraw it.

---

## 3. The cost engine

The one piece that must never rot.

```ts
// src/modules/costing/engine.ts
export function computeCost(
  product: Product,
  quantity: Quantity,
  rates: ResolvedRateSet,   // resolved by the caller, as of an instant
  terms: CommercialTerms,
): CostBreakdown            // a tree, not a number
```

**Properties held by test, forever:**

- **Pure.** No I/O, no clock, no randomness, no database. `Date.now()` does not appear in this module — time enters as a resolved `ResolvedRateSet`.
- **Total.** Every input that can't be costed returns a `Result` error with a stated reason. It never throws, never returns a partial number.
- **Returns the whole tree.** The summary and the detail are the same object, so they cannot disagree. The UI's expandable row is a render of this structure, not a second computation.
- **Every leaf carries provenance** — which rate row, which effective date. A property test asserts this over generated inputs; a number with no origin fails the build.
- **Deterministic.** Same inputs, same bytes out. This is what makes the parity harness possible.

### The parity harness

The most valuable test asset in the project. For each of the 99 products, the spreadsheet's own answer is a golden fixture:

```
tests/parity/fixtures/NCP-4C-50-XLPE-SWA.json   { inputs, expected: { costPerKm, costPerM, ... } }
```

A single test recomputes all 99 and reports pass/fail per product. It runs on every commit. It is how a change to the copper formula, a rate import, or a refactor is proven safe in seconds instead of argued about.

When Phase 4 adds construction-rule costing, **the same harness is its gate**: derive the BOM of all 99 known products from specification alone and match. A model that can't re-derive what we already know isn't trusted with what we don't.

---

## 4. Exactness

```ts
// src/core/money.ts
export type OMR   = Brand<Decimal, 'OMR'>;
export type Kg    = Brand<Decimal, 'Kg'>;
export type Metre = Brand<Decimal, 'Metre'>;
```

Branded types mean a raw `number` cannot reach the engine — it's a compile error, not a runtime surprise. `Decimal` at 28 significant digits internally, **no intermediate rounding**; rounding happens once, at the display and document boundary, via `format.ts`. Floats appear nowhere in the pricing path, and a lint rule bans `parseFloat` and `Number()` inside `modules/costing`.

**Postgres columns are unconstrained `NUMERIC`, not `NUMERIC(18,6)`.** This document specified a fixed scale before the real data arrived; measurement against the imported cost master disproved it. Of 4,513 numeric values in the library, a scale of 6 dp alters **53.7%**, and even 12 dp alters 45% — the sheets carry values like `1.83595955371857` at 15 significant digits. Unconstrained `NUMERIC` round-trips every one of them exactly (`value::text` equals the source string), keeps ordering, `CHECK` and `SUM`, and has no cliff for a future small-magnitude material.

The read path casts every numeric column with `::text` and reconstructs it through `dec()`, so a database driver's own decimal type never enters the pricing path.

### Rounding on a document a customer can check

A screen and a sheet of paper need different precision, and the difference is not cosmetic. On screen a unit rate sits beside the build-up that produced it. On paper it sits beside an amount the customer will multiply out — and the amount is computed from the *unrounded* rate, so the two disagree in the last few baisa. At the 3 dp the screen uses, a 12,500 m line reconciles to within about 4 OMR; at 4 dp, within about 0.6.

So `PRECISION.quotedRate` is 4, and **the document states which figure is authoritative** rather than leaving the customer to find the discrepancy: *"Amounts are calculated on the unrounded unit rate; the rate shown is rounded to 4 places."* Both the PDF and the workbook carry it. The alternative — recomputing amounts from the rounded rate so the paper is self-consistent — was rejected because it would give one quote two different totals depending on where you read it.

A spreadsheet cell is a float whatever we do, so `quote-xlsx.ts` is the one deliberate float boundary in the codebase: `Decimal → toFixed(display precision) → Number`, once, at the edge, with the exact figures still on the Cost build-up sheet's provenance columns.

---

## 5. Data model shape

```
material_rate, machine_rate, overhead_line, margin_rule
  → all carry (valid_from, valid_to), with a Postgres EXCLUDE constraint
    preventing overlapping periods for the same key

lme_price, fx_rate                    → time series, append-only
product → bom_line[] → material_rate
        → machine_op[] → machine_rate
        → overhead_line[]
quote → quote_line → cost_snapshot (JSONB, frozen at approval)
job → job_line → { raw_text, extracted, normalised, match_result, override }
audit_event                           → append-only, never updated
```

**Reconstruction is belt and braces:** a quote stores `priced_at` (so rates can be re-resolved) *and* the frozen breakdown JSONB (so the answer survives a later correction to history). Either alone is insufficient — the first breaks if history is corrected, the second can't say *which rate row* a number came from.

**No hard deletes anywhere.** Rates close with `valid_to`; entities soft-delete. History is the product.

### Scaling the data

At 99 products this is trivial. The decisions that keep it trivial at 10,000:

- Rate resolution is a **single batched query per costing run**, never per-line. Costing 200 lines issues one rate query, not 200.
- `ResolvedRateSet` is an immutable in-memory snapshot, so a 200-line quote costs 200 pure function calls over one snapshot — this is why the < 500 ms full-quote recost budget holds without caching.
- Indexes on `(key, valid_from DESC)` for every effective-dated table.
- `cost_snapshot` JSONB is written once and read rarely; it's the archive, not the hot path.

---

## 6. Server/client boundary

Default to **server components**. Dense tables render on the server; the client receives markup, not a second copy of the data as JSON.

Client components are the exception list, and it stays short: `DataTable` (virtualisation + expansion state), inline rate editors, `CommandPalette`, `ConfirmBar`, the copper ticker.

**The expandable breakdown ships server-rendered with its row.** No fetch on click, no loading state — which is exactly what makes the signature interaction feel like an instrument rather than a web page. Mutations go through **Server Actions** that call module functions; a Server Action is a thin adapter — validate input, call the module, revalidate the path. Business logic never lives in `app/`.

**A Server Action is a public endpoint, so it never accepts a price.** `approveJob` is handed the RFQ *text* and re-prices it server-side through the same `buildJob` the screen used. A number that arrived over the wire is a number nobody at Nuhas computed, and re-pricing also means the quote is struck on the rates in force at the instant of approval rather than whenever the page happened to render. Every action repeats its authority check server-side too: a hidden button is not a permission.

**Quote pages and both export routes are behind sign-in; the rest of the app is not — deliberately.** A rate table is commercially sensitive. A quote carries the customer's name, the price they were given, and the complete internal cost build-up, at a URL an outsider can guess in one try (`Q-2026-0001`). The rest of the screens move behind the same check when sign-in stops being optional.

---

## 7. Background work

`pg-boss` on the same Postgres. No Redis, no separate broker, until volume demands one.

| Job | Cadence | Idempotency key |
|---|---|---|
| `lme.fetch` | Hourly | `(source, date)` |
| `mail.poll` | 2 min | Message id |
| `document.extract` | On enqueue | Content hash — a re-run of an unchanged document costs nothing |
| `pricewatch.sweep` | On LME change + hourly | `(quote_id, lme_id)` |

**Every job is idempotent by key.** At-least-once delivery is assumed, so a duplicate poll can never create a duplicate job or a duplicate charge.

---

## 8. The LLM boundary

Phase 3 only, PDFs only, and fenced tightly. Built; `infra/extraction/model.ts` is the request and `modules/extraction/candidates.ts` is every rule about what may be believed.

- **One file talks to a model.** `infra/extraction/model.ts` sends the document and returns parsed JSON. Swapping providers touches it and nothing else — which stopped being a claim in this document and became a measurement when the app moved from Anthropic to Google: the contract, the instructions, the guards and their 460 tests did not change, and the diff was that one file, a schema translator beside it, and the name of an environment variable.
- **Structured output only.** A strict schema, no free text, no reasoning in the output path. The spec axes are enums *built from the dictionary at call time*, so the model cannot answer with vocabulary the app does not hold, and a term the Rate Owner taught it last week is available today.
- The controlling instruction: *any field you are not certain of, return null.* An empty flagged field is a success; a wrong field is a failure.
- **The model never touches pricing and never touches matching.** It converts document layout into candidate fields — which heading governs which rows, which is the one thing a regular expression cannot see. Its output is text in the form a person would have pasted, and everything after that is the same deterministic path as always.
- **Nothing is taken on trust.** Every row must quote the document verbatim; a quote that is not in the document costs the row. Every number must be printed in what was quoted, compared as a number rather than a substring, so nothing can be computed, rounded or totalled into a price. The size and the quantity must come off the *same row* — one excerpt stating both, or, where the PDF split the row in two, the quantity quoted from the line bearing that row's own number with the description printed beside it. Every spec term must be found in the words that were quoted. Whatever fails is dropped and named in the notes with its item number.
- **Measured, on a real customer RFQ.** 48 rows offered, 45 kept, 27 matching a costed item code exactly — against 0 lines from the pattern reader on the same document. The three refusals were one row with no quantity printed against it, and two rows the customer marked nought. Each of the 18 remaining Partials states its own reason: a real gap in the library, or a field the document does not print.
- **What it still cannot catch.** Two rows split across adjacent lines are genuinely ambiguous in the text: 5.1's description sits as close to 5.2's number as to its own. If the model pairs them the wrong way round, nothing here can tell. That is what the source pane beside every line is for — it opens on the row the quantity was read off. The guards stop invention and distant mixing; the engineer is the check on the row next door.
- **Optional.** With no `GEMINI_API_KEY` the app reads documents exactly as it did before. A call that fails never fails the upload; the pattern reading is used and the engineer is told the closer reading did not come back.
- **Which model, and how that was decided.** `gemini-3.6-flash` — generally available, and the successor to the model that was actually measured. `gemini-3.5-flash` read the real RFQ through these same instructions and guards and gave the answer wanted: 45 lines, 27 exact, the struck-through size corrected on row 1. That is one document, and the one this was written against; the readings that matter are the ones not yet in front of it, where a wrong answer arrives as a plausible schedule rather than an error. The default is one step newer than the measured model on the same family and the same PDF-and-schema interface, and is *cheaper* per output token than it — so there is no saving being traded away for that step. `EXTRACTION_MODEL="gemini-3.5-flash"` returns to measured ground without a deploy; anything else is a model this document has never been put in front of. An earlier revision defaulted to `gemini-3.1-pro-preview` for reasoning headroom on the unmeasured case. That headroom argument holds, but its premise did not: Pro in the 3.x line is preview-only and withdrawable without notice, and costs more per output token than a GA name that is newer than the measured one — so the preview risk was being carried for nothing.

`GEMINI_API_KEY` is the variable this adds — one value, set on the deployment alongside `DATABASE_URL` and `AUTH_SECRET`, and in `.env` for local work. It is read on the server only and never reaches the browser.

**What leaves the building.** With the key set, the text extracted from an uploaded **PDF**, and the PDF itself, are sent to Google's Gemini API. That is customer enquiry data and it crosses the boundary, so it is worth saying plainly. Nothing else goes with it: no spreadsheet, no pasted enquiry, no rate, no cost build-up, no price, no quote, no customer or account record. Documents over 400,000 characters are not sent at all. What the provider does with the text is governed by the commercial terms on the account the key belongs to, not by anything in this repository — read them before pointing this at a customer's document, and unset the key if the answer does not suit. The app works without it.

Not built, and worth knowing: **calls are not cached and the model's raw answer is not stored.** The document's text is kept beside the job, so an extraction can be re-run, but it will not reproduce byte for byte. Re-uploading the same file pays for the same reading twice.

---

## 9. Testing strategy

| Layer | Tool | What it proves |
|---|---|---|
| `core/` | Vitest | Decimal, rounding, branded types |
| `modules/costing` | Vitest + **parity harness** | All 99 products reproduce their spreadsheet at 4 dp |
| `modules/*` | Vitest | Pure logic — fast, no database |
| Property tests | *not built* | Planned on fast-check: every breakdown leaf has provenance; no unpriced line can carry a price. The type system enforces the second today; the first is checked by the parity harness on every fixture |
| Integration | Vitest against a real Postgres (`tests/db`, `pnpm test:db`) | Effective dating, exclusion constraints, quote round trip, parity read back from the store. Skipped, not faked, when `DATABASE_URL` is unset — there is no Testcontainers; point it at any migrated, seeded database |
| E2E | Playwright (`tests/e2e`, `pnpm test:e2e`) | The critical path in a real browser against the production build: sign in → paste → priced → approve → quote → both exports. And the door: anonymous redirects, exports refused unsigned, a viewer who cannot approve, sign-out that ends the session row |
| Visual | *not built* | Planned: Playwright screenshots of a gallery route, so the design system doesn't drift. There is no gallery route yet |
| a11y | *not built* | Planned: axe plus a token contrast check, every token pair at its intended size |

The type system does the rest of the work: **an unpriced line has no price field to render, not a null one.** The spec's central rule — *if it isn't confident, it doesn't price* — is enforced by the shape of the types, so violating it doesn't compile.

---

## 10. Repository layout

```
src/
  core/          Decimal, Money, Result, Id, brands, errors        — imports nothing
  modules/       rates costing catalogue matching quoting
                 extraction jobs pricewatch audit                  — imports core only
  infra/         db/ mail/ storage/ llm/ documents/                — implements ports
  app/           Next routes, server actions, components
  ui/            Design system primitives + tokens
tests/
  parity/        The 99 golden fixtures
  db/            Against a real Postgres: round trips, invariants, parity read back
  e2e/           Playwright, against the production build (needs the same .env)
docs/            PROJECT_PLAN.md · DESIGN_SYSTEM.md · ARCHITECTURE.md
```

`src/ui/` holds the design system and depends on nothing but tokens — so the gallery route renders without a database and visual review never needs a seeded environment.

---

## 11. The rules that keep it changeable

The short list a new engineer reads on day one.

1. **Dependencies point inward.** `core` ← `modules` ← `app`. `infra` is injected, never imported by `modules`.
2. **Modules talk through `index.ts`.** Never reach into another module's internals.
3. **The cost engine is pure and total.** No I/O, no clock, no throw.
4. **No raw numbers in the pricing path.** Branded `Decimal` or it doesn't compile.
5. **No hard deletes.** Close with `valid_to`, soft-delete entities. History is the product.
6. **Every number has provenance.** A leaf with no origin fails the build.
7. **No raw hex, radius, or duration in components.** Tokens only, enforced by lint.
8. **Later phases add modules; they don't edit earlier ones.** If a phase forces edits inward, stop and redraw the boundary.
9. **Every background job is idempotent by key.**
10. **The failure mode is refusing to answer.** Never answering wrongly. When a rule here conflicts with a deadline, this one wins.
