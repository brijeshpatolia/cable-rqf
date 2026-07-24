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

Branded types mean a raw `number` cannot reach the engine — it's a compile error, not a runtime surprise. `Decimal` at 6 dp internally, **no intermediate rounding**; rounding happens once, at the display and document boundary, via `format.ts`. Postgres columns are `NUMERIC(18,6)`. Floats appear nowhere in the pricing path, and a lint rule bans `parseFloat` and `Number()` inside `modules/costing`.

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

Phase 3 only, and fenced tightly:

- Lives in `infra/llm/`, behind a port declared in `modules/extraction`. Swapping providers touches one file.
- **Structured output only.** A strict schema, no free text, no reasoning in the output path.
- The controlling instruction: *any field you are not certain of, return null.* An empty flagged field is a success; a wrong field is a failure.
- **The model never touches pricing and never touches matching.** It converts document layout into candidate fields. Determinism resumes immediately after.
- Every call is cached by content hash and logged with its inputs, so any extraction can be replayed and audited.

---

## 9. Testing strategy

| Layer | Tool | What it proves |
|---|---|---|
| `core/` | Vitest | Decimal, rounding, branded types |
| `modules/costing` | Vitest + **parity harness** | All 99 products reproduce their spreadsheet at 4 dp |
| `modules/*` | Vitest | Pure logic — fast, no database |
| Property tests | fast-check | Every breakdown leaf has provenance; no unpriced line can carry a price |
| Integration | Vitest + Testcontainers | Effective dating, exclusion constraints, reconstruction |
| E2E | Playwright | Keyboard-only path: rate edit → reprice → quote → export |
| Visual | Playwright screenshots of `/_dev/gallery` | The design system doesn't drift |
| a11y | axe + token contrast check | Every token pair at its intended size |

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
