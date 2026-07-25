-- Where the numbers came from.
--
-- Until now the extracted lines replaced the document: `raw_text` held what
-- the reader kept and the file itself was discarded. That makes the Phase 3
-- promise — an engineer never opens the attachment to check a number —
-- impossible to keep, because the answer was thrown away at upload.
--
-- `source_text` is the document as read. `line_sources` maps each extracted
-- line to a place in it. Both are null for a pasted enquiry, where the text is
-- the document, and for every job read before this migration: nothing is
-- back-filled, because a provenance we invented after the fact would be a
-- guess dressed as a record.
ALTER TABLE "job" ADD COLUMN "source_text" TEXT;
ALTER TABLE "job" ADD COLUMN "line_sources" JSONB;

-- Provenance without the document it points into is unusable, and the document
-- with no provenance is merely unhelpful. Only the first is worth refusing.
ALTER TABLE "job"
  ADD CONSTRAINT "job_sources_need_a_document"
  CHECK ("line_sources" IS NULL OR "source_text" IS NOT NULL);
