-- A quote line records *a decision*, not only an override.
--
-- Naming a product is as much a human decision as typing a rate: the engine
-- still does the arithmetic, but a person chose what to cost. The spec asks
-- for the mono `M` marker to persist onto the quote and into history, and it
-- could not — a chosen line was indistinguishable from a matched one once the
-- job was closed. Renaming rather than adding, because these are the same
-- three facts (who, why, when) widened to cover both kinds of decision.
--
-- Hand-written: Prisma models a rename as drop-and-add, which would discard
-- the reasons already recorded.
ALTER TABLE "quote_line" RENAME COLUMN "override_reason" TO "decision_reason";
ALTER TABLE "quote_line" RENAME COLUMN "override_by"     TO "decision_by";
ALTER TABLE "quote_line" RENAME COLUMN "override_at"     TO "decision_at";

-- The constraints move with them. A line is still either costed or explained,
-- and a decision still states who made it and why — but "explained" now also
-- covers a line an engineer chose the product for.
ALTER TABLE "quote_line" DROP CONSTRAINT "quote_line_is_costed_or_explained";
ALTER TABLE "quote_line" DROP CONSTRAINT "quote_line_override_is_reasoned";

ALTER TABLE "quote_line"
  ADD CONSTRAINT "quote_line_is_costed_or_explained"
  CHECK (
    "cost_snapshot" IS NOT NULL
    OR (
      "override_rate" IS NOT NULL
      AND "decision_reason" IS NOT NULL
      AND btrim("decision_reason") <> ''
    )
  );

ALTER TABLE "quote_line"
  ADD CONSTRAINT "quote_line_decision_is_reasoned"
  CHECK (
    ("override_rate" IS NULL AND "decision_reason" IS NULL)
    OR (
      ("override_rate" IS NULL OR "override_rate" > 0)
      AND "decision_reason" IS NOT NULL
      AND btrim("decision_reason") <> ''
      AND "decision_by" IS NOT NULL
      AND "decision_at" IS NOT NULL
    )
  );
