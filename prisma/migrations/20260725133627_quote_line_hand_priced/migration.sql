-- AlterTable
ALTER TABLE "quote_line" ADD COLUMN     "override_at" TIMESTAMPTZ(6),
ADD COLUMN     "override_by" TEXT,
ADD COLUMN     "override_rate" DECIMAL,
ADD COLUMN     "override_reason" TEXT,
ALTER COLUMN "cost_snapshot" DROP NOT NULL;

-- ── Hand-written: guarantees Prisma cannot express ───────────────────────

-- **A quote line is either costed or explained. Never neither.**
--
-- Dropping NOT NULL from the snapshot opened a door: a line with no build-up
-- and no stated reason would be a price on a customer's document that nobody
-- at Nuhas can account for. This closes it again at the only level that
-- counts.
ALTER TABLE "quote_line"
  ADD CONSTRAINT "quote_line_is_costed_or_explained"
  CHECK (
    "cost_snapshot" IS NOT NULL
    OR (
      "override_rate" IS NOT NULL
      AND "override_reason" IS NOT NULL
      AND btrim("override_reason") <> ''
    )
  );

-- And an override, wherever it appears, states who and why.
ALTER TABLE "quote_line"
  ADD CONSTRAINT "quote_line_override_is_reasoned"
  CHECK (
    "override_rate" IS NULL
    OR (
      "override_rate" > 0
      AND "override_reason" IS NOT NULL
      AND btrim("override_reason") <> ''
      AND "override_by" IS NOT NULL
      AND "override_at" IS NOT NULL
    )
  );
