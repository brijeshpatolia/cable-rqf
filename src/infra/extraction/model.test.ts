import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readWithModel } from '@/infra/extraction/model';
import { toGeminiSchema } from '@/infra/extraction/gemini-schema';
import { schemaFor } from '@/modules/extraction';
import { BUILT_IN_TERMS } from '@/modules/matching';

let server: Server;
let seen: Record<string, unknown> = {};
let seenUrl = '';
let answer =
  '{"lines":[{"itemRef":"5.1","cores":2,"sizeMm2":16,"quantity":19000,"quantityUnit":"m","conductor":"Cu","insulation":"XLPE","screen":null,"armour":"SWA","sheath":"PVC","voltage":"1kV","standard":null,"evidence":{"row":["5.1 2C X 16 mm² m 19000"],"heading":[]}}]}';
let finish = 'STOP';
let status = 200;
/** Statuses for the next requests in order, when a test needs them to differ. */
let statuses: number[] = [];
let requests = 0;
/** Run as each request arrives, for a test that needs the clock to have moved. */
let onRequest: (() => void) | undefined;

/*
  Restored after every test rather than by each test that moves them.

  These are shared mutable fixtures, and a test that leaves `answer` set to
  malformed JSON does not fail — the *next* test does, somewhere unrelated,
  for a reason that is nowhere in its own body.
*/
const GOOD = { answer, finish, status };
afterEach(() => {
  answer = GOOD.answer;
  finish = GOOD.finish;
  status = GOOD.status;
  statuses = [];
  requests = 0;
  onRequest = undefined;
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = JSON.parse(body);
      seenUrl = req.url ?? '';
      requests++;
      onRequest?.();
      const code = statuses.shift() ?? status;
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(
        code === 200
          ? JSON.stringify({
              candidates: [{ content: { parts: [{ text: answer }] }, finishReason: finish }],
            })
          : JSON.stringify({ error: { message: 'no' } }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  process.env['GEMINI_BASE_URL'] = `http://127.0.0.1:${port}/v1beta/models`;
  process.env['GEMINI_API_KEY'] = 'test-key';
  // Cleared, not assumed clear. A value in a developer's own `.env` would
  // otherwise fail the default-model assertion below for a reason nowhere in
  // its body.
  delete process.env['EXTRACTION_MODEL'];
});

afterAll(() => server.close());

describe('the request', () => {
  it('is the one intended', async () => {
    await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);

    expect(seenUrl).toBe('/v1beta/models/gemini-3.1-pro-preview:generateContent');
    const config = seen['generationConfig'] as Record<string, unknown>;
    expect(config['responseMimeType']).toBe('application/json');
    expect(config['responseSchema']).toEqual(toGeminiSchema(schemaFor(BUILT_IN_TERMS)));
    expect(config).not.toHaveProperty('temperature');
  });

  it('sends the model named in the environment', async () => {
    process.env['EXTRACTION_MODEL'] = 'gemini-3.5-flash';
    try {
      await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    } finally {
      // In a `finally`, because a rejection here would otherwise leave the
      // variable set and break the test above on the next run.
      delete process.env['EXTRACTION_MODEL'];
    }
    expect(seenUrl).toBe('/v1beta/models/gemini-3.5-flash:generateContent');
  });

  it('sends the file itself alongside the text when there is one', async () => {
    const pdf = new Uint8Array([1, 2, 3, 4]);
    await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS, pdf, 2);

    const parts = (seen['contents'] as { parts: Record<string, unknown>[] }[])[0]?.parts ?? [];
    expect(parts).toHaveLength(2);
    expect(parts[0]?.['inline_data']).toEqual({
      mime_type: 'application/pdf',
      data: Buffer.from(pdf).toString('base64'),
    });
    expect(String(parts[1]?.['text'])).toContain('5.1 2C X 16 mm² m 19000');
  });

  it('leaves a hundred-page bundle out of the request rather than not asking', async () => {
    await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS, new Uint8Array([1]), 400);
    const parts = (seen['contents'] as { parts: Record<string, unknown>[] }[])[0]?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).not.toHaveProperty('inline_data');
  });

  it('parses a good answer', async () => {
    const out = await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    expect(out).toEqual({
      ok: true,
      candidates: [expect.objectContaining({ itemRef: '5.1', armour: 'SWA' })],
    });
  });

  it('refuses a truncated answer rather than keeping half a schedule', async () => {
    finish = 'MAX_TOKENS';
    const out = await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    expect(out).toEqual({ ok: false, why: expect.stringContaining('longer than one answer') });
  });

  it('refuses an answer that stopped for any other reason', async () => {
    finish = 'SAFETY';
    const out = await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    expect(out).toEqual({ ok: false, why: expect.stringContaining('SAFETY') });
  });

  it('states a failure when the body is not the shape asked for', async () => {
    answer = 'sorry, I cannot do that';
    const out = await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    expect(out).toEqual({ ok: false, why: expect.any(String) });
  });

  it('states a failure when the API refuses the request', async () => {
    status = 400;
    const out = await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    expect(out).toEqual({ ok: false, why: expect.stringContaining('400') });
  });

  /*
    The retry is the newest thing in this adapter and the only part of it that
    exists because of a failure seen in the wild: the first live call after it
    was written came back 503 twice inside five seconds, because the first
    draft did not wait. So the pause is driven rather than waited out — the
    suite would otherwise spend four seconds per case doing nothing.

    Only `setTimeout` is faked. The stub server is real HTTP on a real socket,
    and faking the rest of the clock would stop it answering at all. The loop
    yields to real I/O and then nudges the fake clock, so it does not matter
    whether the timer exists yet when the first nudge lands — which is the way
    a naive `advanceTimersByTime` hangs forever.
  */
  /** Hand the real event loop enough turns for a request to land. */
  const io = async (turns = 40) => {
    for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r));
  };

  /**
   * Runs the call with the clock in hand, and reports what the clock did.
   *
   * The count alone is not enough. A test that only asserts "two requests
   * arrived" passes just as happily if the pause is deleted — and the pause is
   * the entire fix, so that is the one assertion worth having. `waited` is
   * whether the second request stayed away while the fake clock sat just short
   * of the four seconds, which is the difference between a backoff and a
   * retry loop with a comment about backoff on it.
   */
  const drive = async <T>(work: Promise<T>): Promise<{ out: T; waited: boolean }> => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      let settled = false;
      const done = work.finally(() => (settled = true));

      // Wait — in real time — for the first answer to come back and the pause
      // to be scheduled. `getTimerCount` is how that becomes observable.
      for (let i = 0; i < 100 && vi.getTimerCount() === 0 && !settled; i++) await io(5);

      await vi.advanceTimersByTimeAsync(3_900);
      await io();
      const waited = requests === 1;

      // And now past it, plus whatever the rest of the call needs.
      for (let i = 0; i < 100 && !settled; i++) {
        await io(5);
        await vi.advanceTimersByTimeAsync(200);
      }
      return { out: await done, waited };
    } finally {
      vi.useRealTimers();
    }
  };

  it('tries once more when the provider says “not now”, after waiting', async () => {
    statuses = [503];
    const { out, waited } = await drive(readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS));
    expect(waited).toBe(true);
    expect(requests).toBe(2);
    expect(out).toEqual({ ok: true, candidates: [expect.objectContaining({ itemRef: '5.1' })] });
  });

  it('states the failure when trying again does not help', async () => {
    statuses = [503, 503];
    const { out, waited } = await drive(readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS));
    expect(waited).toBe(true);
    expect(requests).toBe(2);
    expect(out).toEqual({ ok: false, why: expect.stringContaining('503') });
  });

  it('does not start a second attempt that could not come back in time', async () => {
    // The provider says "not now" — normally worth one more try. But this
    // first attempt ran long before it failed, and a request begun with what
    // is left cannot produce a reading: it would be paid for and then aborted,
    // and the abort would report a timeout in place of what the API actually
    // said. The 503 is the true answer and the one the engineer should get.
    statuses = [503, 200];
    const real = Date.now();
    let elapsed = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => real + elapsed);
    onRequest = () => (elapsed = 150_000);
    try {
      const out = await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
      expect(requests).toBe(1);
      expect(out).toEqual({ ok: false, why: expect.stringContaining('503') });
    } finally {
      clock.mockRestore();
    }
  });

  it('does not try again when trying again cannot help', async () => {
    // A 400 is this app having asked for something impossible. Asking twice
    // spends half the budget to be told so twice.
    status = 400;
    await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    expect(requests).toBe(1);
  });

  it('does not ask at all with no key', async () => {
    const key = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    expect(await readWithModel('anything', BUILT_IN_TERMS)).toBeNull();
    process.env['GEMINI_API_KEY'] = key;
  });
});

/**
 * The contract, in the dialect the provider will take.
 *
 * These are the shapes `schemaFor` actually emits. A translator is only worth
 * having if it is checked against the real thing rather than against an
 * example of it, so the last case runs the whole live schema through — which
 * is what would catch a construct added upstream that this file cannot say.
 */
describe('the schema, translated', () => {
  it('turns “one of these, or null” into a nullable enum', () => {
    expect(
      toGeminiSchema({
        anyOf: [{ type: 'string', enum: ['m', 'km'] }, { type: 'null' }],
        description: 'the unit',
      }),
    ).toEqual({ type: 'STRING', enum: ['m', 'km'], nullable: true, description: 'the unit' });
  });

  it('turns a nullable scalar into a nullable scalar', () => {
    expect(toGeminiSchema({ type: ['integer', 'null'], description: 'cores' })).toEqual({
      type: 'INTEGER',
      nullable: true,
      description: 'cores',
    });
  });

  it('keeps required and drops what the provider has no word for', () => {
    const out = toGeminiSchema({
      type: 'object',
      additionalProperties: false,
      required: ['a'],
      properties: { a: { type: 'string' } },
    });
    expect(out).toEqual({ type: 'OBJECT', required: ['a'], properties: { a: { type: 'STRING' } } });
  });

  it('refuses a shape it cannot say rather than passing it through', () => {
    expect(() => toGeminiSchema({ oneOf: [{ type: 'string' }] })).toThrow();
    expect(() => toGeminiSchema({ type: 'object' })).toThrow();
    expect(() =>
      toGeminiSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] }),
    ).toThrow();
    expect(() => toGeminiSchema({ type: ['number', 'null'], enum: [1, 2] })).toThrow();
  });

  it('says the whole live schema', () => {
    const said = toGeminiSchema(schemaFor(BUILT_IN_TERMS));
    const line = (
      (said['properties'] as Record<string, Record<string, Record<string, unknown>>>)['lines']?.[
        'items'
      ] ?? {}
    ) as Record<string, Record<string, Record<string, unknown>>>;

    expect(said['type']).toBe('OBJECT');
    expect(line['type']).toBe('OBJECT');
    expect(line['properties']?.['sizeMm2']).toMatchObject({ type: 'NUMBER', nullable: true });
    expect(line['properties']?.['armour']).toMatchObject({ type: 'STRING', nullable: true });
    expect((line['properties']?.['armour']?.['enum'] as string[]).length).toBeGreaterThan(1);
    expect(JSON.stringify(said)).not.toContain('additionalProperties');
    expect(JSON.stringify(said)).not.toContain('anyOf');
  });
});
