import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readWithModel } from '@/infra/extraction/model';
import { toGeminiSchema } from '@/infra/extraction/gemini-schema';
import { schemaFor } from '@/modules/extraction';
import { BUILT_IN_TERMS } from '@/modules/matching';

let server: Server;
let seen: Record<string, unknown> = {};
let seenUrl = '';
let answer =
  '{"lines":[{"itemRef":"5.1","cores":2,"sizeMm2":16,"quantity":19000,"quantityUnit":"m","conductor":"Cu","insulation":"XLPE","screen":null,"armour":"SWA","sheath":"PVC","voltage":"1kV","standard":null,"evidence":["5.1 2C X 16 mm² m 19000"]}]}';
let finish = 'STOP';
let status = 200;

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
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = JSON.parse(body);
      seenUrl = req.url ?? '';
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        status === 200
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
});

afterAll(() => server.close());

describe('the request', () => {
  it('is the one intended', async () => {
    await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);

    expect(seenUrl).toBe('/v1beta/models/gemini-3.5-flash:generateContent');
    const config = seen['generationConfig'] as Record<string, unknown>;
    expect(config['responseMimeType']).toBe('application/json');
    expect(config['responseSchema']).toEqual(toGeminiSchema(schemaFor(BUILT_IN_TERMS)));
    expect(config).not.toHaveProperty('temperature');
  });

  it('sends the model named in the environment', async () => {
    process.env['EXTRACTION_MODEL'] = 'gemini-2.5-pro';
    await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    delete process.env['EXTRACTION_MODEL'];
    expect(seenUrl).toBe('/v1beta/models/gemini-2.5-pro:generateContent');
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
