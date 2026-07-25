-- What the document reader made of the file, kept with the job.
--
-- The reader routinely leaves rows out — a quantity of "TBC" is not a quantity
-- worth guessing at — and it names each one. Showing that once at upload and
-- then discarding it would mean a line vanishing from a customer's enquiry with
-- nobody told, which is the exact failure this app exists to prevent.
ALTER TABLE "job" ADD COLUMN "source_notes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
