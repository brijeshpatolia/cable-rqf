-- A product can be revised, and the library says so.
--
-- The parity harness asserts all 99 imported products still reproduce their
-- source cost sheets. Once a person can change a bill of materials, a revised
-- product legitimately stops matching its sheet — that is the whole point of
-- revising it. Recording *that it was revised* lets parity exclude those and
-- report the number, rather than quietly weakening into "whatever the library
-- currently contains reproduces whatever it currently contains".
ALTER TABLE "product" ADD COLUMN "revised_at" TIMESTAMPTZ(6);
ALTER TABLE "product" ADD COLUMN "revised_by_id" UUID;

ALTER TABLE "product"
  ADD CONSTRAINT "product_revised_by_id_fkey"
  FOREIGN KEY ("revised_by_id") REFERENCES "app_user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A revision has an author. An anonymous change to a bill of materials is a
-- change nobody can be asked about.
ALTER TABLE "product"
  ADD CONSTRAINT "product_revision_has_an_author"
  CHECK (("revised_at" IS NULL) = ("revised_by_id" IS NULL));
