import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readWithModel } from '@/infra/extraction/model';
import { BUILT_IN_TERMS } from '@/modules/matching';

let server: Server;
let seen: Record<string, unknown> = {};
let answer = '{"lines":[{"itemRef":"5.1","cores":2,"sizeMm2":16,"quantity":19000,"quantityUnit":"m","conductor":"Cu","insulation":"XLPE","screen":null,"armour":"SWA","sheath":"PVC","voltage":"1kV","standard":null,"evidence":["5.1 2C X 16 mm² m 19000"]}]}';
let stop = 'end_turn';

/*
  Restored after every test rather than by each test that moves them.

  These are shared mutable fixtures, and a test that leaves `answer` set to
  malformed JSON does not fail — the *next* test does, somewhere unrelated,
  for a reason that is nowhere in its own body.
*/
const GOOD = { answer, stop };
afterEach(() => {
  answer = GOOD.answer;
  stop = GOOD.stop;
});

const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        }),
      );
      res.write(
        sse('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
      );
      res.write(
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: answer },
        }),
      );
      res.write(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
      res.write(
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: stop, stop_sequence: null },
          usage: { output_tokens: 5 },
        }),
      );
      res.write(sse('message_stop', { type: 'message_stop' }));
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  process.env['ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${port}`;
  process.env['ANTHROPIC_API_KEY'] = 'sk-test';
});

afterAll(() => server.close());

describe('the request', () => {
  it('is the one intended', async () => {
    await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);

    expect(seen['model']).toBe('claude-opus-5');
    expect(seen['stream']).toBe(true);
    expect(seen['thinking']).toEqual({ type: 'adaptive' });
    expect((seen['output_config'] as Record<string, Record<string, unknown>>)['format']?.['type']).toBe(
      'json_schema',
    );
    expect(seen).not.toHaveProperty('temperature');
  });

  it('parses a good answer', async () => {
    const out = await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    expect(out).toEqual({
      ok: true,
      candidates: [expect.objectContaining({ itemRef: '5.1', armour: 'SWA' })],
    });
  });

  it('refuses a truncated answer rather than keeping half a schedule', async () => {
    stop = 'max_tokens';
    const out = await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    expect(out).toEqual({ ok: false, why: expect.stringContaining('longer than one answer') });
  });

  it('states a failure when the body is not the shape asked for', async () => {
    answer = 'sorry, I cannot do that';
    const out = await readWithModel('5.1 2C X 16 mm² m 19000', BUILT_IN_TERMS);
    expect(out).toEqual({ ok: false, why: expect.any(String) });
  });

  it('does not ask at all with no key', async () => {
    const key = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    expect(await readWithModel('anything', BUILT_IN_TERMS)).toBeNull();
    process.env['ANTHROPIC_API_KEY'] = key;
  });
});
