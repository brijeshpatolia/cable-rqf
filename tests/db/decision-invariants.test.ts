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

  /**
   * Provenance.
   *
   * The claim being defended is narrow and worth stating: the app may hold a
   * document with no map into it, but never a map into a document it does not
   * hold. The second is a set of row numbers pointing at nothing, which the
   * job screen would render as confident, checkable provenance.
   */
  describe('where a line came from', () => {
    it('refuses sources for a document the job does not hold', async () => {
      const err = await attempt(
        `UPDATE job SET line_sources = '[{"line": 3, "where": "row 4"}]'::jsonb
          WHERE id = '${JOB}'`,
      );
      expect(err).toMatch(/job_sources_need_a_document/);
    });

    it('allows the document without them — unhelpful is not the same as wrong', async () => {
      const err = await attempt(
        `UPDATE job SET source_text = 'Dear sir', line_sources = NULL WHERE id = '${JOB}'`,
      );
      expect(err).toBeNull();
    });

    it('allows both together, which is the case that matters', async () => {
      const err = await attempt(
        `UPDATE job
            SET source_text = 'Dear sir\nrow', line_sources = '[{"line": 1, "where": "row 2"}]'::jsonb
          WHERE id = '${JOB}'`,
      );
      expect(err).toBeNull();
    });
  });

  /**
   * Superseding a quote.
   *
   * The immutability trigger has always told people to "supersede it with a
   * new quote". These are the rules that make the resulting chain readable as
   * a history rather than as a set of competing claims about what a customer
   * was told.
   */
  describe('replacing an issued quote', () => {
    /*
      The link is set in the INSERT that creates the quote, exactly as
      `quoteStore.approve` sets it. These tests used to build it with a
      follow-up UPDATE, which the immutability guard now refuses — correctly,
      and it meant every assertion here was really testing that guard rather
      than the one it named.
    */
    const quote = (id: string, number: string, status: string, supersedes?: string) =>
      `INSERT INTO quote (id, number, status, customer, priced_at, valid_until,
                          lme_struck, fx_struck, margin_percent, supersedes_id)
       VALUES ('${id}', '${number}', '${status}', 'TEST CUSTOMER',
               now(), now() + interval '30 days', 9000, 0.3845, 12,
               ${supersedes === undefined ? 'NULL' : `'${supersedes}'`})`;

    const A = '55555555-5555-5555-5555-555555555555';
    const B = '66666666-6666-6666-6666-666666666666';
    const C = '77777777-7777-7777-7777-777777777777';

    it('refuses a quote that supersedes itself', async () => {
      // Raised by the trigger rather than by the CHECK of the same name: a
      // BEFORE trigger is evaluated first. The CHECK still stands behind it.
      const err = await attempt(quote(A, 'Q-TEST-0001', 'approved', A));
      expect(err).toMatch(/cannot supersede itself/);
    });

    it('refuses a second quote claiming to replace the same one', async () => {
      // Two corrections of one quote is a contradiction nobody could resolve
      // from the record: which price is the one standing?
      await withSetup(
        async () => {
          await run(quote(A, 'Q-TEST-0001', 'approved'));
          await run(quote(B, 'Q-TEST-0002', 'approved', A));
        },
        async () => {
          const err = await attempt(quote(C, 'Q-TEST-0003', 'approved', A));
          expect(err).toMatch(/quote_supersedes_id_key|duplicate key/);
        },
      );
    });

    it('refuses superseding a draft — that is editing, not superseding', async () => {
      await withSetup(
        async () => {
          await run(quote(A, 'Q-TEST-0001', 'draft'));
        },
        async () => {
          const err = await attempt(quote(B, 'Q-TEST-0002', 'approved', A));
          expect(err).toMatch(/still a draft/);
        },
      );
    });

    it('allows a chain, which is what a history is', async () => {
      await withSetup(
        async () => {
          await run(quote(A, 'Q-TEST-0001', 'approved'));
          await run(quote(B, 'Q-TEST-0002', 'approved', A));
        },
        async () => {
          expect(await attempt(quote(C, 'Q-TEST-0003', 'approved', B))).toBeNull();
        },
      );
    });

    it('still refuses to edit the superseded quote itself', async () => {
      // The whole point: the old document is what the customer was told, and
      // the correction is a new one that says so.
      await withSetup(
        async () => {
          await run(quote(A, 'Q-TEST-0001', 'approved'));
        },
        async () => {
          const err = await attempt(
            `UPDATE quote SET customer = 'SOMEONE ELSE' WHERE id = '${A}'`,
          );
          expect(err).toMatch(/can no longer be edited/);
        },
      );
    });
  });

  describe('what the supersession chain refuses', () => {
    const G = 'aaaaaaaa-0000-0000-0000-00000000000';
    const quote = (n: number, status: string, supersedes: number | null) =>
      `INSERT INTO quote (id, number, status, customer, priced_at, valid_until,
                          lme_struck, fx_struck, margin_percent, supersedes_id)
       VALUES ('${G}${n}', 'Q-GUARD-${n}', '${status}', 'TEST GUARD CO',
               now(), now() + interval '30 days', 9000, 0.3845, 12,
               ${supersedes === null ? 'NULL' : `'${G}${supersedes}'`})`;

    /** A ← B ← C, every link set at insert time as the app sets it. */
    const chain = async () => {
      await run(quote(1, 'approved', null));
      await run(quote(2, 'approved', 1));
      await run(quote(3, 'approved', 2));
    };

    it('builds a chain of three the way the app does', async () => {
      await withSetup(chain, async () => {
        const heads = await db.query(
          `SELECT number FROM quote q
            WHERE q.status IN ('approved','sent')
              AND NOT EXISTS (SELECT 1 FROM quote r WHERE r.supersedes_id = q.id)
              AND q.customer = 'TEST GUARD CO'`,
        );
        // Exactly the head stands. The price watch reads currency from the
        // link, so anything else here is a quote being swept twice or not at all.
        expect(heads.rows.map((r: { number: string }) => r.number)).toEqual(['Q-GUARD-3']);
      });
    });

    it('refuses to detach the link on an issued quote', async () => {
      await withSetup(chain, async () => {
        const err = await attempt(
          `UPDATE quote SET supersedes_id = NULL WHERE id = '${G}2'`,
        );
        expect(err).toMatch(/can no longer be edited/);
      });
    });

    it('refuses to close a cycle', async () => {
      // Stopped by the frozen link rather than by the cycle walk — which is
      // the point: with the link immutable there is no way to form a ring.
      await withSetup(chain, async () => {
        const err = await attempt(
          `UPDATE quote SET supersedes_id = '${G}3' WHERE id = '${G}1'`,
        );
        expect(err).not.toBeNull();
      });
    });

    it('refuses to let a draft supersede a live quote', async () => {
      /*
        The worst of the four. A draft superseding a live quote drops that
        quote off the price watch — its copper silently stops being hedged —
        and takes the UNIQUE slot, so the real correction can never be issued.
      */
      await withSetup(chain, async () => {
        const err = await attempt(quote(4, 'draft', 3));
        expect(err).toMatch(/draft cannot supersede/);
      });
    });

    it('refuses to delete an issued quote, head of a chain or not', async () => {
      await withSetup(chain, async () => {
        // The head is the case ON DELETE RESTRICT never covered: nothing
        // supersedes it, and its lines used to cascade past the immutability
        // trigger, which reads the parent's status and finds it already gone.
        expect(await attempt(`DELETE FROM quote WHERE id = '${G}3'`)).toMatch(
          /cannot be deleted/,
        );
        expect(await attempt(`DELETE FROM quote WHERE id = '${G}1'`)).not.toBeNull();
      });
    });

    it('still lets a draft be deleted, lines and all', async () => {
      // The guard is on the quote rather than on its lines precisely so this
      // keeps working: a draft is not a promise anyone made to a customer.
      await withSetup(
        async () => {
          await run(quote(9, 'draft', null));
        },
        async () => {
          expect(await attempt(`DELETE FROM quote WHERE id = '${G}9'`)).toBeNull();
        },
      );
    });
  });
});
