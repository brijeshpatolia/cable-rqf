-- Superseding a quote.
--
-- `quote_is_immutable_once_approved` has been telling people, since the day it
-- was written, to "supersede it with a new quote" — and the schema offered no
-- way to. An approved quote with a mistake in it was simply stuck, which
-- leaves the only remaining option a phone call and a private spreadsheet.
--
-- A chain, not a tree: `UNIQUE` means one quote replaces at most one other and
-- is replaced by at most one. Q-3 supersedes Q-2 supersedes Q-1 reads as a
-- history; two quotes both claiming to replace Q-1 would be a contradiction
-- nobody could resolve from the record.
--
-- `RESTRICT` because the superseded quote is the reason the new one exists.
-- Deleting it would leave a correction with nothing to correct.
ALTER TABLE "quote" ADD COLUMN "supersedes_id" UUID;

ALTER TABLE "quote"
  ADD CONSTRAINT "quote_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "quote"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE UNIQUE INDEX "quote_supersedes_id_key" ON "quote"("supersedes_id");

-- A quote cannot replace itself. Cheap to state, and the alternative is a row
-- that is its own history.
ALTER TABLE "quote"
  ADD CONSTRAINT "quote_supersedes_another"
  CHECK ("supersedes_id" IS DISTINCT FROM "id");

-- Only a quote that was actually issued can be superseded.
--
-- Enforced here rather than in the action because it is the kind of rule that
-- has to hold however the row was written: a draft is not a promise anyone
-- made to a customer, so replacing one is editing, not superseding.
CREATE OR REPLACE FUNCTION public.quote_supersedes_an_issued_quote()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_status "QuoteStatus";
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO previous_status FROM quote WHERE id = NEW.supersedes_id;

  IF previous_status = 'draft' THEN
    RAISE EXCEPTION
      'quote % is still a draft, so there is nothing to supersede. Edit it instead.',
      (SELECT number FROM quote WHERE id = NEW.supersedes_id)
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER quote_supersedes_an_issued_quote
  BEFORE INSERT OR UPDATE OF supersedes_id ON "quote"
  FOR EACH ROW EXECUTE FUNCTION public.quote_supersedes_an_issued_quote();
