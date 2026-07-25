import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * What the database refuses.
 *
 * The human-in-the-loop path rests on one rule: **an engineer may overrule the
 * app, but never silently.** That rule is worth exactly as much as the place
 * it is enforced. A form handler is one code path; a CHECK constraint is the
 * guarantee. This file is the proof that the guarantee is real — every
 * assertion here is an attempt to write the thing the business says is
 * impossible, made directly against the database with Prisma's own validation
 * bypassed.
 *
 * Uses `pg` directly rather than Prisma. Prisma pools connections, so `BEGIN`
 * and the statement after it can land on different sessions — and a test of
 * transactional behaviour that silently runs outside a transaction proves
 * nothing. One client, one session, one transaction, rolled back at the end.
 *
 * Requires a migrated database. Skipped when DATABASE_URL is unset so
 * `pnpm test` stays database-free.
 */

const url = process.env['DATABASE_URL'];

const ACTOR = '11111111-1111-1111-1111-111111111111';
const JOB = '22222222-2222-2222-2222-222222222222';
const TERM = '33333333-3333-3333-3333-333333333333';
const OTHER_TERM = '44444444-4444-4444-4444-444444444444';

/**
 * Canonicals no catalogue would ever hold.
 *
 * `PVC` collided the first time this ran against a database somebody had
 * actually used — the unique on (axis, canonical) fired in `beforeAll` and
 * every assertion silently skipped. A fixture that can collide with real data
 * is a fixture that stops testing without saying so.
 */
const CANONICAL = 'TEST-CANONICAL-A';
const OTHER_CANONICAL = 'TEST-CANONICAL-B';

describe.skipIf(url === undefined)('invariants the database enforces', () => {
  let db: Client;
  const run = (sql: string) => db.query(sql);

  /**
   * Tries a statement and reports the refusal, or null if it was allowed.
   *
   * Always rolls back, including on success — otherwise an accepted row leaks
   * into the next probe and the constraint under test is never the thing that
   * fires. That bug is how this file first passed while proving nothing.
   */
  const attempt = async (sql: string): Promise<string | null> => {
    await run('SAVEPOINT probe');
    try {
      await run(sql);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      await run('ROLLBACK TO SAVEPOINT probe');
    }
  };

  /** For probes that need a row to already exist before the conflicting one. */
  const withSetup = async (setup: () => Promise<unknown>, body: () => Promise<void>) => {
    await run('SAVEPOINT scope');
    try {
      await setup();
      await body();
    } finally {
      await run('ROLLBACK TO SAVEPOINT scope');
    }
  };

  const line = (cols: string, vals: string) =>
    `INSERT INTO job_line (id, job_id, position, ${cols})
     VALUES (gen_random_uuid(), '${JOB}', 0, ${vals})`;

  const DECIDED = `'${ACTOR}', now()`;

  beforeAll(async () => {
    db = new Client({ connectionString: url! });
    await db.connect();

    // Everything below runs inside one transaction that is never committed, so
    // the probes leave no trace in the development database.
    await run('BEGIN');
    await run(
      `INSERT INTO app_user (id, email, name, role)
       VALUES ('${ACTOR}', 'invariants@test.invalid', 'Invariants', 'engineer')`,
    );
    await run(
      `INSERT INTO job (id, reference, raw_text)
       VALUES ('${JOB}', 'J-TEST-0001', '3C x 50mm2 Cu XLPE SWA PVC 1kV')`,
    );
    await run(
      `INSERT INTO vocabulary_term (id, canonical, axis) VALUES ('${TERM}', '${CANONICAL}', 'sheath')`,
    );
    await run(
      `INSERT INTO vocabulary_term (id, canonical, axis) VALUES ('${OTHER_TERM}', '${OTHER_CANONICAL}', 'sheath')`,
    );
  });

  afterAll(async () => {
    await db?.query('ROLLBACK');
    await db?.end();
  });

  describe('a decision without a reason is not a decision', () => {
    it('refuses a hand price with no reason', async () => {
      const err = await attempt(line('override_rate, decided_by_id, decided_at', `5, ${DECIDED}`));
      expect(err).toContain('job_line_decision_is_reasoned');
    });

    it('refuses a reason that is only whitespace', async () => {
      const err = await attempt(
        line('override_rate, decision_reason, decided_by_id, decided_at', `5, '   ', ${DECIDED}`),
      );
      expect(err).toContain('job_line_decision_is_reasoned');
    });

    it('refuses a decision with no author', async () => {
      const err = await attempt(
        line('override_rate, decision_reason', `5, 'because I said so'`),
      );
      expect(err).toContain('job_line_decision_is_reasoned');
    });

    it('refuses a row that decides nothing at all', async () => {
      const err = await attempt(
        line('decision_reason, decided_by_id, decided_at', `'because', ${DECIDED}`),
      );
      expect(err).toContain('job_line_decision_is_reasoned');
    });

    it('accepts a hand price that states its reason and its author', async () => {
      const err = await attempt(
        line(
          'override_rate, decision_reason, decided_by_id, decided_at',
          `7.5, 'Quoted off the 2025 aluminium job.', ${DECIDED}`,
        ),
      );
      expect(err).toBeNull();
    });
  });

  describe('a price is a price', () => {
    it('refuses a hand price of zero', async () => {
      const err = await attempt(
        line('override_rate, decision_reason, decided_by_id, decided_at', `0, 'free', ${DECIDED}`),
      );
      expect(err).toContain('job_line_override_positive');
    });

    it('refuses a negative hand price', async () => {
      const err = await attempt(
        line('override_rate, decision_reason, decided_by_id, decided_at', `-1, 'oops', ${DECIDED}`),
      );
      expect(err).toContain('job_line_override_positive');
    });
  });

  describe('a chosen product needs both halves of its key', () => {
    // The library's natural key is (code, source_sheet): two sheets share a
    // code, so half a key would price on whichever row came back first.
    it('refuses a code with no source sheet', async () => {
      const err = await attempt(
        line(
          'chosen_product_code, decision_reason, decided_by_id, decided_at',
          `'P07CS3M2XLVWVKNN', 'same construction', ${DECIDED}`,
        ),
      );
      expect(err).toContain('job_line_choice_is_whole');
    });

    it('accepts a whole key', async () => {
      const err = await attempt(
        line(
          'chosen_product_code, chosen_source_sheet, decision_reason, decided_by_id, decided_at',
          `'P07CS3M2XLVWVKNN', 'LV', 'same construction', ${DECIDED}`,
        ),
      );
      expect(err).toBeNull();
    });
  });

  describe('a quoted job is history', () => {
    it('refuses a new decision, and refuses an edit to the text', async () => {
      await withSetup(
        () => run(`UPDATE job SET status = 'approved' WHERE id = '${JOB}'`),
        async () => {
          const decision = await attempt(
            line(
              'override_rate, decision_reason, decided_by_id, decided_at',
              `5, 'too late', ${DECIDED}`,
            ),
          );
          expect(decision).toContain('cannot be changed');

          const edit = await attempt(`UPDATE job SET raw_text = 'rewritten' WHERE id = '${JOB}'`);
          expect(edit).toContain('can no longer be edited');
        },
      );
    });
  });

  describe('one phrase means one thing on one axis', () => {
    it('refuses a synonym that was not folded before storing', async () => {
      // Otherwise `canonicalise` would depend on how the Rate Owner typed it.
      const err = await attempt(
        `INSERT INTO vocabulary_synonym (id, term_id, axis, phrase)
         VALUES (gen_random_uuid(), '${TERM}', 'sheath', 'TEST-PHRASE-A')`,
      );
      expect(err).toContain('vocabulary_synonym_is_folded');
    });

    it('refuses a synonym claiming an axis its term is not on', async () => {
      const err = await attempt(
        `INSERT INTO vocabulary_synonym (id, term_id, axis, phrase)
         VALUES (gen_random_uuid(), '${TERM}', 'insulation', 'test-phrase-a')`,
      );
      expect(err).toContain('claims axis insulation');
    });

    it('accepts a folded synonym on its term’s own axis', async () => {
      const err = await attempt(
        `INSERT INTO vocabulary_synonym (id, term_id, axis, phrase)
         VALUES (gen_random_uuid(), '${TERM}', 'sheath', 'test-phrase-a')`,
      );
      expect(err).toBeNull();
    });

    it('refuses the same phrase pointing at two different terms on one axis', async () => {
      // This is the one that matters: "XLPO means PVC" and "XLPO means LSOH"
      // would make every line containing it price differently depending on
      // which row the planner returned first.
      await withSetup(
        () =>
          run(
            `INSERT INTO vocabulary_synonym (id, term_id, axis, phrase)
             VALUES (gen_random_uuid(), '${TERM}', 'sheath', 'test-phrase-a')`,
          ),
        async () => {
          const err = await attempt(
            `INSERT INTO vocabulary_synonym (id, term_id, axis, phrase)
             VALUES (gen_random_uuid(), '${OTHER_TERM}', 'sheath', 'test-phrase-a')`,
          );
          expect(err).toMatch(/vocabulary_synonym_axis_phrase_key|duplicate key/);
        },
      );
    });
  });

  describe('a substitution is a judgement someone signed for', () => {
    const rule = (axis: string, from: string, to: string, why: string) =>
      `INSERT INTO substitution_rule (id, axis, from_term, to_term, rationale)
       VALUES (gen_random_uuid(), '${axis}', '${from}', '${to}', '${why}')`;

    // Synthetic terms throughout, for the same reason the canonicals are: a
    // fixture that can collide with a rule somebody really declared is a
    // fixture that stops testing without saying so.
    it('refuses a term substituted for itself', async () => {
      const err = await attempt(rule('sheath', 'TEST-FROM', 'TEST-FROM', 'none'));
      expect(err).toContain('substitution_rule_is_a_substitution');
    });

    it('refuses a rule with no rationale', async () => {
      const err = await attempt(rule('sheath', 'TEST-FROM', 'TEST-TO', '   '));
      expect(err).toContain('substitution_rule_is_a_substitution');
    });

    it('refuses a rule on an axis that is not a matching axis', async () => {
      const err = await attempt(rule('colour', 'Black', 'Grey', 'looks the same'));
      expect(err).toContain('substitution_rule_is_a_substitution');
    });

    it('refuses the same rule declared twice while in force', async () => {
      await withSetup(
        () => run(rule('sheath', 'TEST-FROM', 'TEST-TO', 'Synthetic rule, for the uniqueness probe below.')),
        async () => {
          const err = await attempt(rule('sheath', 'TEST-FROM', 'TEST-TO', 'again'));
          expect(err).toMatch(/substitution_rule_in_force_unique|duplicate key/);
        },
      );
    });

    it('allows the rule to be re-declared once the old one is retired', async () => {
      // History is the product: a quote struck on a rule stays explainable
      // after the rule is withdrawn, so retiring closes rather than deletes.
      await withSetup(
        async () => {
          await run(rule('armour', 'TEST-SWA', 'TEST-AWA', 'Synthetic rule, retired below.'));
          await run(
            `UPDATE substitution_rule SET retired_at = now()
              WHERE axis = 'armour' AND from_term = 'TEST-SWA' AND to_term = 'TEST-AWA'`,
          );
        },
        async () => {
          const err = await attempt(rule('armour', 'TEST-SWA', 'TEST-AWA', 'Re-declared after review.'));
          expect(err).toBeNull();
        },
      );
    });
  });
});
