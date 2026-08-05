/**
 * The response schema, said in the provider's dialect.
 *
 * `modules/extraction` writes the contract once, in JSON Schema, because that
 * is the neutral spelling and the one its own tests read. Google's API wants
 * the same contract in OpenAPI's flavour instead: types in upper case, and a
 * field that may be absent marked `nullable: true` rather than carrying a null
 * branch. So the translation lives here, in the adapter, alongside every other
 * thing that is true of one vendor and not of the task.
 *
 * That split is what made swapping providers a day's work rather than a
 * rewrite. The contract, the instructions, and every rule about what may be
 * believed did not move; only this file and the request beside it did.
 *
 * **It throws on anything it does not recognise.** A translator that passed an
 * unfamiliar construct through unchanged would produce a schema the API
 * quietly ignores, and a schema that is quietly ignored is a model free to
 * invent a cable spec — the exact failure the enum was built to make
 * impossible. Failing loudly means a shape added upstream is caught by the
 * test below rather than by a customer's quote.
 */

const SCALARS: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
};

export function toGeminiSchema(node: unknown): Record<string, unknown> {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error(`schema node is not an object: ${JSON.stringify(node)}`);
  }
  const src = node as Record<string, unknown>;

  /*
    `anyOf: [X, {type:'null'}]` — the spelling the contract uses for an
    optional enum — becomes the branch that is not null, marked nullable.
    Google's Schema has no `anyOf` at all, so leaving it in place would drop
    the enum and with it the guarantee that an axis can only hold one of
    Nuhas's own words.
  */
  if ('anyOf' in src) {
    const branches = src['anyOf'];
    if (!Array.isArray(branches)) throw new Error('anyOf is not an array');
    const real = branches.filter(
      (b) => (b as Record<string, unknown> | null)?.['type'] !== 'null',
    );
    if (real.length !== 1 || real.length === branches.length) {
      throw new Error(
        'anyOf is only understood as "one shape, or null"; ' +
          `this one has ${branches.length} branches`,
      );
    }
    const only = toGeminiSchema(real[0]);
    return {
      ...only,
      nullable: true,
      ...(typeof src['description'] === 'string' ? { description: src['description'] } : {}),
    };
  }

  const rawType = src['type'];
  // `type: ['integer','null']` — the same idea in JSON Schema's own spelling.
  const nullable = Array.isArray(rawType) && rawType.includes('null');
  const type = Array.isArray(rawType) ? rawType.find((t) => t !== 'null') : rawType;
  if (typeof type !== 'string') {
    throw new Error(`schema node has no single type: ${JSON.stringify(rawType)}`);
  }

  const out: Record<string, unknown> = {};
  if (typeof src['description'] === 'string') out['description'] = src['description'];
  if (nullable) out['nullable'] = true;

  if (type === 'object') {
    const properties = src['properties'];
    if (typeof properties !== 'object' || properties === null) {
      throw new Error('an object with no properties would let anything through');
    }
    out['type'] = 'OBJECT';
    out['properties'] = Object.fromEntries(
      Object.entries(properties as Record<string, unknown>).map(([k, v]) => [
        k,
        toGeminiSchema(v),
      ]),
    );
    /*
      `required` is carried across; `additionalProperties` is dropped, because
      Google's Schema has no such key. Nothing is lost that matters: every
      field the app reads is named in `required`, and a stray extra one is
      ignored by the parse rather than believed.
    */
    if (Array.isArray(src['required'])) out['required'] = [...src['required']];
    return out;
  }

  if (type === 'array') {
    if (!('items' in src)) throw new Error('an array with no items describes nothing');
    out['type'] = 'ARRAY';
    out['items'] = toGeminiSchema(src['items']);
    return out;
  }

  const scalar = SCALARS[type];
  if (scalar === undefined) throw new Error(`unknown schema type “${type}”`);
  out['type'] = scalar;
  if (Array.isArray(src['enum'])) {
    /*
      Google only takes an enum on a string field. Stringifying a numeric one
      to fit would change what the model is allowed to answer — and change it
      silently, in the one place the app relies on the request itself to keep
      an invented spec out.
    */
    if (scalar !== 'STRING') throw new Error(`an enum on a ${scalar} field is not accepted`);
    out['enum'] = [...src['enum']];
  }
  return out;
}
