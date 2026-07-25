-- ═══════════════════════════════════════════════════════════════════════════
-- Invariants Prisma's schema language cannot express.
--
-- This file is appended verbatim to the initial migration. It is kept
-- separately because it is the part of the schema that carries the actual
-- guarantees — the generated DDL above it only creates tables.
--
-- Every statement here is covered by tests/db/invariants.test.ts, which
-- executes the violating case and asserts the database refuses it.
-- ═══════════════════════════════════════════════════════════════════════════

-- Required by the EXCLUDE constraints: btree_gist lets a plain-equality
-- column (the rate's code) sit alongside a range overlap test in one GiST
-- index. Verified available on local Postgres 16.13 and Neon 18.4.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── No two rates in force for the same code at the same instant ───────────
--
-- The invariant the whole effective-dating design rests on. It belongs in the
-- database rather than in application code a later feature could bypass.
--
-- `valid_to` NULL means open-ended, which tstzrange treats as unbounded — so
-- an open row conflicts with any later overlapping row, while an ADJACENT row
-- (a clean supersede, where one period ends exactly as the next begins) is
-- accepted. That distinction is the one worth testing.

ALTER TABLE "material_rate"
  ADD CONSTRAINT "material_rate_no_overlap"
  EXCLUDE USING gist (
    "code" WITH =,
    tstzrange("valid_from", "valid_to", '[)') WITH &&
  );

ALTER TABLE "machine_rate"
  ADD CONSTRAINT "machine_rate_no_overlap"
  EXCLUDE USING gist (
    "code" WITH =,
    tstzrange("valid_from", "valid_to", '[)') WITH &&
  );

-- ── A period cannot end before it starts ──────────────────────────────────
ALTER TABLE "material_rate"
  ADD CONSTRAINT "material_rate_period_ordered"
  CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from");

ALTER TABLE "machine_rate"
  ADD CONSTRAINT "machine_rate_period_ordered"
  CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from");

-- ── Rates and prices are non-negative ─────────────────────────────────────
--
-- Deliberately >= 0 rather than > 0: a genuine zero rate exists in the
-- imported library — machine RBD-TWD1 costs 0.000 OMR/hr on several sheets.
ALTER TABLE "material_rate"
  ADD CONSTRAINT "material_rate_non_negative" CHECK ("rate" >= 0);

ALTER TABLE "material_rate"
  ADD CONSTRAINT "material_rate_premium_non_negative"
  CHECK ("drawing_premium" IS NULL OR "drawing_premium" >= 0);

-- An LME-linked code prices off copper and must carry a premium; a fixed code
-- must not, because a premium there would silently do nothing.
ALTER TABLE "material_rate"
  ADD CONSTRAINT "material_rate_premium_iff_lme_linked"
  CHECK (("lme_linked" AND "drawing_premium" IS NOT NULL)
      OR (NOT "lme_linked" AND "drawing_premium" IS NULL));

ALTER TABLE "machine_rate"
  ADD CONSTRAINT "machine_rate_non_negative" CHECK ("rate" >= 0);

ALTER TABLE "lme_price"
  ADD CONSTRAINT "lme_price_positive" CHECK ("lme" > 0 AND "fx" > 0);

-- ── Quantities cannot be negative ─────────────────────────────────────────
ALTER TABLE "bom_line"
  ADD CONSTRAINT "bom_line_non_negative"
  CHECK ("consumption" >= 0 AND "scrap" >= 0);

ALTER TABLE "machine_op"
  ADD CONSTRAINT "machine_op_non_negative"
  CHECK ("hours_per_km" >= 0 AND "cores" >= 1);

ALTER TABLE "product"
  ADD CONSTRAINT "product_shape" CHECK ("cores" >= 1 AND "size_mm2" > 0);

-- ── History is the product: append-only tables ────────────────────────────
--
-- Triggers rather than permission grants, so they hold for every role
-- including the one the app connects as. An audit trail that can be edited is
-- not an audit trail.

CREATE OR REPLACE FUNCTION reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- The LME series records facts about moments. A tick is never corrected in
-- place — a wrong one is superseded by a later entry, so the quote that was
-- struck on it can still be reconstructed exactly.
CREATE TRIGGER lme_price_no_update
  BEFORE UPDATE ON "lme_price"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER lme_price_no_delete
  BEFORE DELETE ON "lme_price"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ── Supporting indexes for the resolve-as-of query ────────────────────────
--
-- The EXCLUDE constraints already build a GiST index that serves the in-force
-- lookup. These partial unique indexes make "the row in force right now" — by
-- far the most common query — a single-row probe, and independently guarantee
-- that only one row per code can be open at a time.
CREATE UNIQUE INDEX "material_rate_one_in_force"
  ON "material_rate" ("code") WHERE "valid_to" IS NULL;

CREATE UNIQUE INDEX "machine_rate_one_in_force"
  ON "machine_rate" ("code") WHERE "valid_to" IS NULL;
