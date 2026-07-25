-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('review', 'approved', 'abandoned');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('paste', 'upload', 'email');

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'review',
    "customer" TEXT,
    "terms" TEXT,
    "source" "JobSource" NOT NULL DEFAULT 'paste',
    "source_name" TEXT,
    "raw_text" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "quote_id" UUID,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_line" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "override_rate" DECIMAL,
    "chosen_product_code" TEXT,
    "chosen_source_sheet" TEXT,
    "decision_reason" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vocabulary_term" (
    "id" UUID NOT NULL,
    "canonical" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vocabulary_term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vocabulary_synonym" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "axis" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "times_seen" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vocabulary_synonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substitution_rule" (
    "id" UUID NOT NULL,
    "axis" TEXT NOT NULL,
    "from_term" TEXT NOT NULL,
    "to_term" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "substitution_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_reference_key" ON "job"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "job_quote_id_key" ON "job"("quote_id");

-- CreateIndex
CREATE INDEX "job_status_created_at_idx" ON "job"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "job_customer_idx" ON "job"("customer");

-- CreateIndex
CREATE INDEX "job_line_job_id_idx" ON "job_line"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_line_job_id_position_key" ON "job_line"("job_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "vocabulary_term_id_axis_key" ON "vocabulary_term"("id", "axis");

-- CreateIndex
CREATE UNIQUE INDEX "vocabulary_term_axis_canonical_key" ON "vocabulary_term"("axis", "canonical");

-- CreateIndex
CREATE INDEX "vocabulary_synonym_term_id_idx" ON "vocabulary_synonym"("term_id");

-- CreateIndex
CREATE UNIQUE INDEX "vocabulary_synonym_axis_phrase_key" ON "vocabulary_synonym"("axis", "phrase");

-- CreateIndex
CREATE INDEX "substitution_rule_axis_idx" ON "substitution_rule"("axis");

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_line" ADD CONSTRAINT "job_line_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_line" ADD CONSTRAINT "job_line_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocabulary_term" ADD CONSTRAINT "vocabulary_term_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocabulary_synonym" ADD CONSTRAINT "vocabulary_synonym_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "vocabulary_term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitution_rule" ADD CONSTRAINT "substitution_rule_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written: guarantees Prisma cannot express ───────────────────────

-- **A decision without a reason is not a decision.**
--
-- This is the rule the whole human-in-the-loop path rests on: an engineer may
-- overrule the app, but never silently. Enforced here rather than in a form
-- handler, because a form handler is one code path and this is the guarantee.
-- A row must carry at least one decision, and any decision must carry a
-- reason and an author.
ALTER TABLE "job_line"
  ADD CONSTRAINT "job_line_decision_is_reasoned"
  CHECK (
    ("override_rate" IS NOT NULL OR "chosen_product_code" IS NOT NULL)
    AND "decision_reason" IS NOT NULL
    AND btrim("decision_reason") <> ''
    AND "decided_by_id" IS NOT NULL
    AND "decided_at" IS NOT NULL
  );

-- A hand price is a price. Negative or zero is a mistake, not a discount.
ALTER TABLE "job_line"
  ADD CONSTRAINT "job_line_override_positive"
  CHECK ("override_rate" IS NULL OR "override_rate" > 0);

-- A chosen product needs both halves of its key: the library's natural key is
-- (code, source_sheet), and two sheets share a code.
ALTER TABLE "job_line"
  ADD CONSTRAINT "job_line_choice_is_whole"
  CHECK (("chosen_product_code" IS NULL) = ("chosen_source_sheet" IS NULL));

-- An approved job is history. Its text and its decisions are the record of
-- what was quoted and why, so they stop being editable at the same moment the
-- quote does.
CREATE OR REPLACE FUNCTION job_is_immutable_once_approved()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.raw_text IS DISTINCT FROM OLD.raw_text THEN
    RAISE EXCEPTION
      'job % has been quoted and its text can no longer be edited', OLD.reference
      USING ERRCODE = '0A000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_immutable_once_approved
  BEFORE UPDATE ON "job"
  FOR EACH ROW EXECUTE FUNCTION job_is_immutable_once_approved();

CREATE OR REPLACE FUNCTION job_line_is_immutable_once_approved()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  s TEXT;
BEGIN
  SELECT status INTO s FROM "job"
   WHERE id = COALESCE(NEW.job_id, OLD.job_id);
  IF s = 'approved' THEN
    RAISE EXCEPTION
      'the decisions on a quoted job cannot be changed'
      USING ERRCODE = '0A000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER job_line_immutable_once_approved
  BEFORE INSERT OR UPDATE OR DELETE ON "job_line"
  FOR EACH ROW EXECUTE FUNCTION job_line_is_immutable_once_approved();

-- Vocabulary phrases are stored folded, so the uniqueness the parser relies on
-- is the uniqueness the database enforces. Two rows differing only in case or
-- punctuation would make `canonicalise` depend on insertion order.
ALTER TABLE "vocabulary_synonym"
  ADD CONSTRAINT "vocabulary_synonym_is_folded"
  CHECK ("phrase" = btrim(lower("phrase")) AND "phrase" <> '');

-- The composite foreign key that makes the denormalised axis honest: a synonym
-- can only claim the axis of the term it actually belongs to.
ALTER TABLE "vocabulary_synonym"
  ADD CONSTRAINT "vocabulary_synonym_axis_matches_term"
  FOREIGN KEY ("term_id", "axis")
  REFERENCES "vocabulary_term" ("id", "axis")
  ON UPDATE CASCADE ON DELETE CASCADE;

-- A substitution is directional and lives on one axis; the same swap declared
-- twice is a maintenance trap, not a stronger rule. Retired rules are kept, so
-- uniqueness applies only to the ones in force.
CREATE UNIQUE INDEX "substitution_rule_in_force_unique"
  ON "substitution_rule" ("axis", "from_term", "to_term")
  WHERE "retired_at" IS NULL;

-- A rule that swaps a term for itself matches everything and means nothing.
ALTER TABLE "substitution_rule"
  ADD CONSTRAINT "substitution_rule_is_a_substitution"
  CHECK (
    "from_term" <> "to_term"
    AND btrim("rationale") <> ''
    AND "axis" IN ('conductor','insulation','screen','armour','sheath','voltage','standard')
  );
