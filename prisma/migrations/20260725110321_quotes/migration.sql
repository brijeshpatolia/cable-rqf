-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('draft', 'approved', 'sent', 'lapsed');

-- CreateTable
CREATE TABLE "quote" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'draft',
    "customer" TEXT NOT NULL,
    "terms" TEXT,
    "priced_at" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "lme_struck" DECIMAL NOT NULL,
    "fx_struck" DECIMAL NOT NULL,
    "margin_percent" DECIMAL NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "request_text" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "source_sheet" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "quantity_metres" DECIMAL NOT NULL,
    "unit_rate" DECIMAL NOT NULL,
    "line_total" DECIMAL NOT NULL,
    "cost_snapshot" JSONB NOT NULL,

    CONSTRAINT "quote_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quote_number_key" ON "quote"("number");

-- CreateIndex
CREATE INDEX "quote_status_created_at_idx" ON "quote"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quote_customer_idx" ON "quote"("customer");

-- CreateIndex
CREATE INDEX "quote_line_quote_id_idx" ON "quote_line"("quote_id");

-- CreateIndex
-- Position is the order on the printed document. Two lines claiming the same
-- position would render in whatever order the planner felt like.
CREATE UNIQUE INDEX "quote_line_quote_id_position_key" ON "quote_line"("quote_id", "position");

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written: guarantees Prisma cannot express ───────────────────────

-- Quantities and money on a quote line are non-negative, and a quote's
-- validity cannot end before it was priced.
ALTER TABLE "quote_line"
  ADD CONSTRAINT "quote_line_non_negative"
  CHECK ("quantity_metres" > 0 AND "unit_rate" >= 0 AND "line_total" >= 0);

ALTER TABLE "quote"
  ADD CONSTRAINT "quote_validity_ordered"
  CHECK ("valid_until" > "priced_at");

ALTER TABLE "quote"
  ADD CONSTRAINT "quote_strike_positive"
  CHECK ("lme_struck" > 0 AND "fx_struck" > 0);

-- An approved quote is a promise that was made. Its lines and its strike are
-- the record of what was offered, so once it leaves draft it stops being
-- editable — corrections are made by superseding it with a new quote, exactly
-- as a rate is superseded rather than overwritten.
CREATE OR REPLACE FUNCTION quote_is_immutable_once_approved()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    -- Status may still advance (approved -> sent -> lapsed); nothing else may.
    IF NEW.customer IS DISTINCT FROM OLD.customer
       OR NEW.priced_at IS DISTINCT FROM OLD.priced_at
       OR NEW.lme_struck IS DISTINCT FROM OLD.lme_struck
       OR NEW.fx_struck IS DISTINCT FROM OLD.fx_struck
       OR NEW.margin_percent IS DISTINCT FROM OLD.margin_percent
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until THEN
      RAISE EXCEPTION
        'quote % is % and can no longer be edited. Supersede it with a new quote.',
        OLD.number, OLD.status
        USING ERRCODE = '0A000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quote_immutable_once_approved
  BEFORE UPDATE ON "quote"
  FOR EACH ROW EXECUTE FUNCTION quote_is_immutable_once_approved();

-- The lines of a quote that has left draft are fixed outright.
CREATE OR REPLACE FUNCTION quote_line_is_immutable_once_approved()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  s TEXT;
BEGIN
  SELECT status INTO s FROM "quote"
   WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
  IF s IS NOT NULL AND s <> 'draft' THEN
    RAISE EXCEPTION
      'the lines of an approved quote cannot be changed'
      USING ERRCODE = '0A000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER quote_line_immutable
  BEFORE UPDATE OR DELETE ON "quote_line"
  FOR EACH ROW EXECUTE FUNCTION quote_line_is_immutable_once_approved();
