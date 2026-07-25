-- CreateEnum
CREATE TYPE "Role" AS ENUM ('rateOwner', 'engineer', 'viewer');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "password_hash" TEXT,
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_rate" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL,
    "lme_linked" BOOLEAN NOT NULL,
    "drawing_premium" DECIMAL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_rate" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lme_price" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "lme" DECIMAL NOT NULL,
    "fx" DECIMAL NOT NULL,
    "entered_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lme_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "source_sheet" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "cores" INTEGER NOT NULL,
    "size_mm2" DECIMAL NOT NULL,
    "conductor" TEXT NOT NULL,
    "insulation" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "armour" TEXT NOT NULL,
    "sheath" TEXT NOT NULL,
    "voltage" TEXT NOT NULL,
    "tooling_per_km" DECIMAL NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_line" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "material_key" TEXT NOT NULL,
    "material_name" TEXT NOT NULL,
    "consumption" DECIMAL NOT NULL,
    "scrap" DECIMAL NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "bom_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_op" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "machine_key" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "hours_per_km" DECIMAL NOT NULL,
    "cores" DECIMAL NOT NULL,

    CONSTRAINT "machine_op_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overhead_line" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "overhead_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_email" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previous" TEXT NOT NULL,
    "next" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "material_rate_code_valid_from_idx" ON "material_rate"("code", "valid_from" DESC);

-- CreateIndex
CREATE INDEX "machine_rate_code_valid_from_idx" ON "machine_rate"("code", "valid_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "lme_price_at_key" ON "lme_price"("at");

-- CreateIndex
CREATE INDEX "lme_price_at_idx" ON "lme_price"("at" DESC);

-- CreateIndex
CREATE INDEX "product_code_idx" ON "product"("code");

-- CreateIndex
CREATE INDEX "product_family_idx" ON "product"("family");

-- CreateIndex
CREATE UNIQUE INDEX "product_code_source_sheet_key" ON "product"("code", "source_sheet");

-- CreateIndex
CREATE INDEX "bom_line_product_id_idx" ON "bom_line"("product_id");

-- CreateIndex
CREATE INDEX "machine_op_product_id_idx" ON "machine_op"("product_id");

-- CreateIndex
CREATE INDEX "overhead_line_product_id_idx" ON "overhead_line"("product_id");

-- CreateIndex
CREATE INDEX "audit_event_at_idx" ON "audit_event"("at" DESC);

-- CreateIndex
CREATE INDEX "audit_event_entity_at_idx" ON "audit_event"("entity", "at" DESC);

-- AddForeignKey
ALTER TABLE "bom_line" ADD CONSTRAINT "bom_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_op" ADD CONSTRAINT "machine_op_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overhead_line" ADD CONSTRAINT "overhead_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
