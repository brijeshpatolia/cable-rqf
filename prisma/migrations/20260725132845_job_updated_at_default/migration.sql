-- DropForeignKey
--
-- Prisma proposed this, and it is right to: a composite foreign key on
-- (term_id, axis) is not expressible in the schema language, so every future
-- `migrate dev` would propose dropping it again. A hand-written constraint
-- that the differ keeps trying to delete is not a guarantee, it is a chore.
-- The same rule is re-stated below as a trigger, which the differ does not
-- model and therefore never touches — which is exactly why the rest of this
-- schema's real guarantees are triggers too.
ALTER TABLE "vocabulary_synonym" DROP CONSTRAINT "vocabulary_synonym_axis_matches_term";

-- AlterTable
ALTER TABLE "job" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- The denormalised axis on a synonym must be the axis of the term it belongs
-- to. Without this the (axis, phrase) unique index enforces nothing useful:
-- a row could claim any axis it liked and the parser would resolve the phrase
-- onto the wrong one.
CREATE OR REPLACE FUNCTION vocabulary_synonym_axis_matches_term()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  term_axis TEXT;
BEGIN
  SELECT axis INTO term_axis FROM "vocabulary_term" WHERE id = NEW.term_id;
  IF term_axis IS DISTINCT FROM NEW.axis THEN
    RAISE EXCEPTION
      'synonym "%" claims axis % but its term is on axis %',
      NEW.phrase, NEW.axis, term_axis
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vocabulary_synonym_axis_is_honest
  BEFORE INSERT OR UPDATE ON "vocabulary_synonym"
  FOR EACH ROW EXECUTE FUNCTION vocabulary_synonym_axis_matches_term();
