import Anthropic from '@anthropic-ai/sdk';
import { type Candidate, INSTRUCTIONS, schemaFor } from '@/modules/extraction';
import { type Term } from '@/modules/matching';

/**
 * The one place in this app that talks to a model.
 *
 * It is an adapter and nothing more: it sends the document's text, gets JSON
 * back, and hands it to `modules/extraction` to be disbelieved. Every rule
 * about what may be trusted is in that pure module, where a test can put a
 * fabricated answer in front of it without a network. This file's whole job is
 * the request, the timeout, and refusing to throw.
 *
 * **Optional, deliberately.** With no `ANTHROPIC_API_KEY` configured the app
 * reads documents exactly as it did before — the pattern reader, its stated
 * limits, and the paste box. An enquiry has never depended on a third party
 * being up, and adding one that could take intake down with it would be a poor
 * trade for a tool ten people use to answer customers the same day.
 */

/** Long enough for a forty-row schedule; short enough that a stall is not a hang. */
const TIMEOUT_MS = 120_000;

/**
 * Documents larger than this are not sent.
 *
 * An RFQ is a handful of pages. Something an order of magnitude past that is a
 * standards bundle or a drawing set that has been attached by mistake, and
 * sending it would spend real money to be told there are no cables in it. The
 * pattern reader still runs on it and still says what it found.
 */
const MAX_CHARS = 400_000;

/**
 * Three outcomes, not two.
 *
 * `null` means the model was never asked — no key, or nothing worth sending —
 * and the app should read the document the way it always did, with nothing to
 * report. A failure is different: somebody configured this expecting it to
 * work, and the engineer in front of a badly-read document deserves to know
 * that the closer reading was attempted and did not come back, rather than
 * quietly getting the old behaviour and wondering.
 */
export type ModelReading =
  | { readonly ok: true; readonly candidates: readonly Candidate[] }
  | { readonly ok: false; readonly why: string };

function failed(why: string): ModelReading {
  // Into the server log as well, because the note the engineer sees is
  // deliberately short and "what exactly did the API say" is an operator's
  // question, not theirs.
  console.error(`[extraction] the model could not read this document: ${why}`);
  return { ok: false, why };
}

/**
 * Ask the model to read the document's layout.
 *
 * Never throws. Every way this can go wrong — a refusal, a timeout, a rate
 * limit, a truncated answer, a body that is not the JSON it was asked for —
 * comes back as a stated failure, because the one thing an enquiry must not do
 * is fail to open.
 */
export async function readWithModel(
  text: string,
  terms: readonly Term[],
): Promise<ModelReading | null> {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (key === undefined || key.trim() === '') return null;
  if (text.trim() === '') return null;
  if (text.length > MAX_CHARS) {
    return failed(
      `it is ${Math.round(text.length / 1000)}k characters long, which is past ` +
        'the point where a file is an enquiry rather than a standards bundle',
    );
  }

  try {
    const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 2 });

    /*
      Streamed because a long schedule is a long answer, and a non-streaming
      request of this size is the classic way to collect a request timeout
      after two minutes of work that was going to succeed.
    */
    const message = await client.messages
      .stream({
        model: 'claude-opus-5',
        max_tokens: 32_000,
        // Adaptive: deciding which heading governs which rows is the one thing
        // being asked for, and it is exactly the sort of reasoning that is
        // worth a moment's thought and cheap to get wrong quickly.
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema: schemaFor(terms) } },
        messages: [{ role: 'user', content: `${INSTRUCTIONS}\n\n---\n\n${text}` }],
      })
      .finalMessage();

    // A refusal has no content worth reading, and reading it as an empty
    // document would be a silent one.
    if (message.stop_reason === 'refusal') return failed('the request was declined');
    /*
      A truncated answer is a half-read schedule, and half a schedule looks
      exactly like a whole one on screen. The rows that arrived are worth less
      than the rows that silently did not, so none of it is kept.
    */
    if (message.stop_reason === 'max_tokens') {
      return failed('the schedule was longer than one answer could hold');
    }

    const body = message.content.find((b) => b.type === 'text');
    if (body === undefined) return failed('it answered with nothing');

    const parsed: unknown = JSON.parse(body.text);
    const lines = (parsed as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines)) return failed('it did not answer in the shape it was asked for');

    return {
      ok: true,
      candidates: lines.filter((l): l is Candidate => typeof l === 'object' && l !== null),
    };
  } catch (cause) {
    /*
      Caught rather than thrown on, and this is the one place in the app that
      does it. Every failure here has the same answer — read the document the
      way it was read before — and an engineer with an enquiry in front of them
      is not helped by an HTTP status where their cables should be.
    */
    return failed(cause instanceof Error ? cause.message : String(cause));
  }
}
