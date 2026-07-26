-- The supersession invariants, actually enforced.
--
-- `20260726080000_quote_supersession` promised "a chain, not a tree", and
-- `schema.prisma` says "a superseded quote is never edited and never deleted".
-- Neither held. Four probes, each run against the real seeded rows with a
-- control first to prove the relevant trigger was armed, showed Postgres
-- accepting all four of the things this app says are impossible.
--
-- The point of putting a guarantee in the database is that it holds however
-- the row was written. "You would need psql access" is not a defence — it is
-- precisely the case these triggers exist for.

-- ── 1. The link is part of the frozen document ────────────────────────────
--
-- `quote_is_immutable_once_approved` froze customer, priced_at, the strike and
-- valid_until, and left `supersedes_id` out — because the column did not exist
-- when it was written. But the link is the single source of truth for which
-- price stands: `open()` decides what is on the price watch by asking whether
-- anything supersedes a quote. Leaving it writable meant a superseded quote
-- could be silently restored to the price watch, or a correction detached from
-- what it corrected, with no audit row and no trace.
--
-- Frozen outright rather than allowing NULL -> non-NULL: the app sets the link
-- in the same INSERT that creates the quote, so nothing legitimate ever needs
-- to acquire one later. A path nobody uses is a path nobody tests.
CREATE OR REPLACE FUNCTION public.quote_is_immutable_once_approved()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    -- Status may still advance (approved -> sent -> lapsed); nothing else may.
    IF NEW.customer IS DISTINCT FROM OLD.customer
       OR NEW.priced_at IS DISTINCT FROM OLD.priced_at
       OR NEW.lme_struck IS DISTINCT FROM OLD.lme_struck
       OR NEW.fx_struck IS DISTINCT FROM OLD.fx_struck
       OR NEW.margin_percent IS DISTINCT FROM OLD.margin_percent
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
      RAISE EXCEPTION
        'quote % is % and can no longer be edited. Supersede it with a new quote.',
        OLD.number, OLD.status
        USING ERRCODE = '0A000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Both ends of the link must be a real promise ───────────────────────
--
-- The original guard asked only whether the quote being *replaced* was a
-- draft, on the stated grounds that a draft is not a promise anyone made to a
-- customer. The same reasoning applies to the replacement and was not applied:
-- a draft was free to supersede a live quote, which dropped that quote off the
-- price watch — its copper silently stops being hedged — and squatted the
-- UNIQUE slot so the real correction could never be issued.
CREATE OR REPLACE FUNCTION public.quote_supersedes_an_issued_quote()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_status "QuoteStatus";
  hops INT := 0;
  cursor_id UUID;
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

  IF NEW.status = 'draft' THEN
    RAISE EXCEPTION
      'a draft cannot supersede quote %. Only a quote that has been issued can '
      'replace one — until then it is an edit, not a correction.',
      (SELECT number FROM quote WHERE id = NEW.supersedes_id)
      USING ERRCODE = '23514';
  END IF;

  -- ── 3. A chain, not a ring ──────────────────────────────────────────────
  --
  -- `quote_supersedes_another` compared the row against itself and stopped
  -- there, so A -> B -> A satisfied every guard. A ring has no head, and
  -- `open()` excludes a quote when anything supersedes it, so closing a cycle
  -- made *both* quotes vanish from the price watch at once: two live promises
  -- to a customer, neither of them hedged, and nothing on any screen to say so.
  --
  -- Walked iteratively with a hop limit rather than as a recursive CTE. If a
  -- cycle somehow already exists in the data, a plain recursive walk spins
  -- forever holding a lock; this raises instead, which is the behaviour worth
  -- having in the case where the invariant is already broken.
  --
  -- The one-hop case — a quote superseding itself — is reachable on INSERT and
  -- is tested. A longer ring is not, as things stand: freezing the link above
  -- and barring drafts from superseding leaves no way to close one, because an
  -- INSERT cannot (a brand-new row's id is in nobody's history) and the UPDATE
  -- that used to is now refused. That branch is therefore defence rather than
  -- a live guard, and is stated as untested rather than claimed as proven. It
  -- earns its place the moment anyone relaxes the freeze — allowing a link to
  -- be acquired after approval, say — at which point it is the only thing
  -- between the price watch and two live quotes that hide each other.
  -- Named separately from the general cycle below because the row is not in
  -- the table yet on INSERT, so looking up "the quote it points at" returns
  -- NULL and the message read "cannot supersede <NULL>". The CHECK constraint
  -- `quote_supersedes_another` says the same thing and still stands, but a
  -- BEFORE trigger is evaluated first, so this is the message people see.
  IF NEW.supersedes_id = NEW.id THEN
    RAISE EXCEPTION
      'quote % cannot supersede itself (quote_supersedes_another).', NEW.number
      USING ERRCODE = '23514';
  END IF;

  cursor_id := NEW.supersedes_id;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION
        'quote % cannot supersede %: it is already somewhere in that quote''s history.',
        NEW.number, (SELECT number FROM quote WHERE id = NEW.supersedes_id)
        USING ERRCODE = '23514';
    END IF;

    hops := hops + 1;
    IF hops > 1000 THEN
      RAISE EXCEPTION 'supersession chain from quote % is unreasonably long or already circular',
        NEW.number
        USING ERRCODE = '23514';
    END IF;

    SELECT supersedes_id INTO cursor_id FROM quote WHERE id = cursor_id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- `status` joins the watched columns: the guard above now depends on it, so a
-- row that acquires its link as a draft and is approved afterwards must be
-- re-checked rather than slipping through on the insert alone.
DROP TRIGGER IF EXISTS quote_supersedes_an_issued_quote ON "quote";
CREATE TRIGGER quote_supersedes_an_issued_quote
  BEFORE INSERT OR UPDATE OF supersedes_id, status ON "quote"
  FOR EACH ROW EXECUTE FUNCTION public.quote_supersedes_an_issued_quote();

-- ── 4. An issued quote cannot be deleted at all ───────────────────────────
--
-- `quote_line_is_immutable_once_approved` refuses to touch the lines of an
-- approved quote — unless the quote itself is going, in which case it looks up
-- the parent's status, finds the row already gone, and lets the cascade
-- through. `IF s IS NOT NULL AND s <> 'draft'` fails *open* on exactly the
-- path that destroys the most.
--
-- `ON DELETE RESTRICT` on `supersedes_id` only ever protected quotes something
-- else already pointed at. The head of a chain — the quote that actually
-- stands — was deletable, taking its lines with it and nulling `job.quote_id`,
-- so the enquiry lost all record of having been quoted.
--
-- Guarded at the parent rather than by making the line trigger fail closed,
-- because a draft quote genuinely can be deleted and its lines genuinely
-- should cascade. Refusing at the quote keeps that case working.
CREATE OR REPLACE FUNCTION public.quote_is_undeletable_once_issued()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION
      'quote % is % and cannot be deleted. It is what a customer was told; '
      'supersede it with a new quote instead.',
      OLD.number, OLD.status
      USING ERRCODE = '0A000';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS quote_is_undeletable_once_issued ON "quote";
CREATE TRIGGER quote_is_undeletable_once_issued
  BEFORE DELETE ON "quote"
  FOR EACH ROW EXECUTE FUNCTION public.quote_is_undeletable_once_issued();
