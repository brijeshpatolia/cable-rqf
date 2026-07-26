-- Sessions that can be ended.
--
-- Signing out deleted the cookie from the browser and nothing else. The token
-- is a signed statement — it stays valid until it expires no matter what the
-- app would prefer — so a copy taken from a shared machine, a proxy log, or a
-- devtools panel on a screenshare kept working for the rest of its twelve
-- hours. "Sign out" is the control a person reaches for when they think
-- something has gone wrong, and it was the one thing it could not do.
--
-- A row per sign-in, referenced by id from inside the token. Ending a session
-- is now an UPDATE, and the check costs nothing: `currentActor()` already
-- queries `app_user` on every request to see whether the account is still
-- enabled, so this rides along on that query as a join.
--
-- Not enforced in the middleware, deliberately. The perimeter runs on the Edge
-- with no database; it asks whether this app signed the cookie, which is the
-- question it can answer without one. Everything a signed-in request can reach
-- goes through `currentActor()`.
-- No `DEFAULT gen_random_uuid()` on the id, matching every other table here:
-- Prisma's `@default(uuid())` generates it in the client, so a database default
-- would be a second source for the same value that nothing ever reaches. It
-- also keeps `prisma migrate diff` quiet, which matters — a drift report that
-- always says something is a drift report nobody reads.
CREATE TABLE "app_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_session_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "app_session_user_id_idx" ON "app_session"("user_id");

-- Cascades: a user removed outright takes their sessions with them. There is
-- nothing to preserve in a session row whose account no longer exists, and
-- leaving orphans would mean the sweep below has to reason about them.
ALTER TABLE "app_session"
  ADD CONSTRAINT "app_session_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Revocation is one-way.
--
-- Without this, "un-revoke" is an UPDATE away, and a session someone ended
-- because they thought it was compromised could be quietly reopened by
-- anything with write access. The whole value of the row is that ending it
-- means ended.
CREATE OR REPLACE FUNCTION public.app_session_revocation_is_final()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'session % has already ended and cannot be reopened. Sign in again.',
      OLD.id
      USING ERRCODE = '0A000';
  END IF;

  -- The identity of a session is not editable either: moving `user_id` would
  -- hand one person's live token to another account.
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'session % is a record of a sign-in and cannot be rewritten.',
      OLD.id
      USING ERRCODE = '0A000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER app_session_revocation_is_final
  BEFORE UPDATE ON "app_session"
  FOR EACH ROW EXECUTE FUNCTION public.app_session_revocation_is_final();
