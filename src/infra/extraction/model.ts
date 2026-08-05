import { type Candidate, INSTRUCTIONS, schemaFor } from '@/modules/extraction';
import { type Term } from '@/modules/matching';
import { toGeminiSchema } from './gemini-schema';

/**
 * The one place in this app that talks to a model.
 *
 * It is an adapter and nothing more: it sends the document, gets JSON back,
 * and hands it to `modules/extraction` to be disbelieved. Every rule about
 * what may be trusted is in that pure module, where a test can put a
 * fabricated answer in front of it without a network. This file's whole job is
 * the request, the timeout, and refusing to throw.
 *
 * **Optional, deliberately.** With no `GEMINI_API_KEY` configured the app
 * reads documents exactly as it did before — the pattern reader, its stated
 * limits, and the paste box. An enquiry has never depended on a third party
 * being up, and adding one that could take intake down with it would be a poor
 * trade for a tool ten people use to answer customers the same day.
 *
 * **Which model, and why this one.** Pro, deliberately, and it is worth being
 * exact about what that is and is not based on. Flash was measured against the
 * customer RFQ this was built against — the same file, the same instructions,
 * the same guards downstream — and returned the same forty-five lines, the
 * same twenty-seven exact matches, and the same corrected size on the row that
 * had been struck through by hand. On that document the cheaper model was not
 * worse. But one document is one document, and it is the document this was
 * written against, which is the weakest possible evidence about the next one.
 *
 * What the reading is actually for is the hard case: a schedule whose heading
 * governs rows three pages later, a size struck out by hand, a note that
 * withdraws a line. Those are the documents where the models differ, and they
 * are exactly the ones not yet in front of this. A wrong reading here does not
 * announce itself — it is a plausible schedule, and someone quotes from it. So
 * the default buys headroom on the case that has not been measured, and the
 * saving is a setting away for whoever decides it is worth taking.
 *
 * `fetch`, not a vendor SDK. One endpoint, one shape, and the timeout this
 * needs is the one the platform already gives — a dependency here would buy
 * retry logic that has to be overridden anyway, for the reason set out below.
 */

/**
 * Two budgets, because one is not enough.
 *
 * `TIMEOUT_MS` bounds a single attempt; `BUDGET_MS` bounds all of them
 * together. Only the second one matters, and it is the one a retrying client
 * will not give you: a per-attempt timeout multiplies by the retry count, so
 * 120 seconds with two retries is a six-minute worst case on the
 * upload request path. Past the platform's function limit the process is
 * *killed*, and a killed function cannot state its reason — which is the one
 * promise this file makes. A budget that expires is an abort this code
 * catches.
 *
 * One retry, not two. A second retry buys a small amount of luck against a
 * blip and costs the whole time budget; the engineer would rather be told in
 * three minutes than kept waiting for five.
 *
 * The per-attempt number is close to the budget on purpose, and it moved when
 * the default model did. Flash read the real RFQ in 95 seconds; a model that
 * reasons more takes longer, and a 120-second cap on the attempt would have
 * turned "slower" into "always fails" — a timeout on a call that was going to
 * answer. What the retry is actually for is the failure that comes back
 * *immediately*: the `503 — high demand` this saw twice inside five seconds on
 * its first live call. Those leave the budget almost untouched, so a longer
 * attempt costs the retry nothing it was ever going to use.
 */
const TIMEOUT_MS = 180_000;
const BUDGET_MS = 190_000;

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
 * And a cap on the file, not only on the text it yielded.
 *
 * A scan has almost no text layer and can still be a hundred megabytes, so the
 * character cap above waves it through. Inline document data is bounded by the
 * whole request, which this provider holds to 20 MB, and base64 adds a third —
 * so the raw file has to leave room for its own encoding as well as for the
 * text and the schema beside it. 12 MB encodes to 16 and lands comfortably
 * inside. Past either limit the file is still *read*; it is only the model
 * that does not see it.
 *
 * The number carried over from the previous provider was 16 MB, which encodes
 * to 21.3 — over the limit, and it took a review to notice. It has never been
 * reachable, because the upload itself refuses anything over 8 MB long before
 * this function sees it, and that door is the bound that actually holds. This
 * one is the belt: it should be true on its own rather than true only because
 * something upstream is stricter, since the upstream number is exactly the
 * sort of thing that gets raised one day by someone who did not read this.
 */
const MAX_PDF_BYTES = 12_000_000;
const MAX_PDF_PAGES = 100;

/**
 * The model, overridable without a deploy.
 *
 * The variable exists so that a provider outage, a deprecation, or a model
 * worth trying is a change to one setting rather than a release. Setting it to
 * `gemini-3.5-flash` is the measured, cheaper reading described above and the
 * one thing here anybody should feel free to do; anything else is a model
 * nobody has put this document in front of.
 */
const DEFAULT_MODEL = 'gemini-3.5-pro';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/*
  Read when the call is made, not when the module loads. A serverless function
  is reused across requests, so a value captured at import time is the value
  from whenever that instance happened to start — which makes "I changed the
  setting and nothing changed" true for an unpredictable while.
*/
const modelName = () => process.env['EXTRACTION_MODEL']?.trim() || DEFAULT_MODEL;

/**
 * Generous, because the way this budget fails is total.
 *
 * A schedule that runs past it stops mid-answer — at which point the rows that
 * did arrive are thrown away below, because half a schedule on screen looks
 * exactly like a whole one. The real RFQ this was built against spent under
 * twelve thousand. Unspent tokens cost nothing.
 */
const MAX_OUTPUT_TOKENS = 60_000;

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

/** The parts of the response this file reads. Everything else is ignored. */
interface Answer {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
    readonly finishReason?: string;
  }[];
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly error?: { readonly message?: string };
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
  /**
   * The file itself, when there is one.
   *
   * Sent alongside the extracted text rather than instead of it, because the
   * two answer different questions. The text is what the app can *check* an
   * answer against — every quote is looked for in it. The document is what
   * carries everything the text layer throws away, and the thing it throws
   * away is not decoration: on the RFQ this was built against, a size had been
   * struck through and replaced by hand. A strikethrough is a line drawn over
   * the glyphs, so the text layer returns both numbers with nothing to tell
   * them apart, and the app read out the cancelled one — 500 mm² where the
   * customer wanted 300, against 3,750 m. Given the page, the model reads it
   * correctly and says which was withdrawn.
   */
  pdf?: Uint8Array,
  /** How many pages it has, so a hundred-page bundle is not sent as one block. */
  pages = 0,
): Promise<ModelReading | null> {
  const key = process.env['GEMINI_API_KEY'];
  if (key === undefined || key.trim() === '') return null;
  if (text.trim() === '') return null;
  if (text.length > MAX_CHARS) {
    return failed(
      `it is ${Math.round(text.length / 1000)}k characters long, which is past ` +
        'the point where a file is an enquiry rather than a standards bundle',
    );
  }

  /*
    Too big to send is not too big to read. The text still goes, and the only
    thing lost is the model's sight of the page — which matters for a marked-up
    schedule and not at all for a standards bundle nobody meant to attach.
  */
  const document =
    pdf !== undefined && pdf.byteLength <= MAX_PDF_BYTES && pages <= MAX_PDF_PAGES
      ? pdf
      : undefined;

  const prompt =
    document === undefined
      ? `${INSTRUCTIONS}\n\n---\n\n${text}`
      : `${INSTRUCTIONS}\n\n` +
        'The text below was extracted from the same document. Quote from it ' +
        'character for character; use the pages above to decide which values ' +
        'are in force.\n\n---\n\n' +
        text;

  try {
    const body = JSON.stringify({
      contents: [
        {
          parts: [
            ...(document === undefined
              ? []
              : [
                  {
                    inline_data: {
                      mime_type: 'application/pdf',
                      data: Buffer.from(document).toString('base64'),
                    },
                  },
                ]),
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        /*
          Every spec axis is an enum of Nuhas's own terms, so "invented a
          plausible cable spec" is not a failure mode anything downstream has
          to catch — the request will not produce one.
        */
        responseSchema: toGeminiSchema(schemaFor(terms)),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    });

    const answer = await withOneRetry(
      `${process.env['GEMINI_BASE_URL'] ?? ENDPOINT}/${modelName()}:generateContent`,
      key,
      body,
    );
    if (!answer.ok) return failed(answer.why);

    const blocked = answer.body.promptFeedback?.blockReason;
    if (blocked !== undefined) return failed(`the request was declined (${blocked})`);

    const first = answer.body.candidates?.[0];
    if (first === undefined) return failed('it answered with nothing');
    /*
      A truncated answer is a half-read schedule, and half a schedule looks
      exactly like a whole one on screen. The rows that arrived are worth less
      than the rows that silently did not, so none of it is kept.
    */
    if (first.finishReason === 'MAX_TOKENS') {
      return failed('the schedule was longer than one answer could hold');
    }
    // Anything other than a clean stop is a partial or withheld answer under
    // another name, and reading one as a document would be a silent loss.
    if (first.finishReason !== undefined && first.finishReason !== 'STOP') {
      return failed(`it stopped early (${first.finishReason})`);
    }

    const parts = first.content?.parts;
    if (parts === undefined || parts.length === 0) return failed('it answered with nothing');
    const parsed: unknown = JSON.parse(parts.map((p) => p.text ?? '').join(''));

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

/**
 * The request, once, and again only if trying again could help.
 *
 * A 429 or a 5xx is the provider saying "not now", and not now is often over
 * in a second. A 400 is this app having asked for something impossible, and
 * asking twice wastes half the budget to be told so twice — the schema fault
 * that cost a live call to find was a 400, and it would have been one either
 * way. Both attempts share `BUDGET_MS`, so the retry cannot push the function
 * past the limit that kills it.
 *
 * **And it waits first.** The first version did not, and the first live run
 * after it was written came back `503 — this model is currently experiencing
 * high demand` twice inside five seconds. Two requests that close together are
 * one request with extra cost: whatever was busy is still busy. The pause is
 * short enough to be invisible against a two-minute read and long enough for a
 * spike to pass, and it is cut short by the budget rather than running past it
 * — waiting four seconds to discover there is no time left to use them is a
 * strange way to spend the end of a timeout.
 */
const RETRY_AFTER_MS = 4_000;
async function withOneRetry(
  url: string,
  key: string,
  body: string,
): Promise<{ ok: true; body: Answer } | { ok: false; why: string }> {
  const deadline = AbortSignal.timeout(BUDGET_MS);
  let last = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.any([deadline, AbortSignal.timeout(TIMEOUT_MS)]),
    });

    if (res.ok) return { ok: true, body: (await res.json()) as Answer };

    const said = ((await res.json().catch(() => ({}))) as Answer).error?.message;
    last = `the API answered ${res.status}${said === undefined ? '' : ` — ${said}`}`;
    if (res.status !== 429 && res.status < 500) break;
    if (attempt === 0 && !deadline.aborted) await pause(deadline);
    if (deadline.aborted) break;
  }

  return { ok: false, why: last };
}

/** The pause before the retry, cut short if the budget runs out first. */
function pause(deadline: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, RETRY_AFTER_MS);
    deadline.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
