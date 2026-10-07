import { ProtocolLimits, RelayFrameCodec, type JsonObject, type JsonValue } from '../../src/modules/relay-link/protocol-core/index.js';

export type PlainJson = null | boolean | number | string | readonly PlainJson[] | { readonly [key: string]: PlainJson };

/** Converts ordinary JSON fields through the original strict phone protocol parser. */
export function jsonFields(input: Readonly<Record<string, PlainJson>>): JsonObject['fields'] {
  let tokens = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++tokens > ProtocolLimits.maxJsonTokens || depth > ProtocolLimits.maxJsonNestingDepth) throw new TypeError('JSON exceeds protocol limits');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === undefined) throw new TypeError('Expected a JSON value');
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Expected a plain JSON object');
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('JSON cannot contain symbols');
    for (const item of Object.values(value)) visit(item, depth + 1);
  };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected JSON fields');
  visit(input, 1);
  const bytes = new TextEncoder().encode(JSON.stringify({ type: 'telemetry', payload: input, capabilities: {} }));
  const result = RelayFrameCodec.decode(bytes);
  if (result.kind !== 'decoded' || result.frame.type !== 'telemetry') throw new TypeError('JSON fields violate the phone protocol');
  return result.frame.payload.fields;
}

/** Use numberMode=string when exact incoming decimal tokens must be preserved. */
export function toPlainJson(value: JsonValue, numberMode: 'number' | 'string' = 'number'): PlainJson {
  switch (value.kind) {
    case 'null': return null;
    case 'string': case 'boolean': return value.value;
    case 'number': return numberMode === 'string' ? value.value : Number(value.value);
    case 'array': return Object.freeze(value.values.map(item => toPlainJson(item, numberMode)));
    case 'object': return Object.freeze(Object.fromEntries(Object.entries(value.fields).map(([key, item]) => [key, toPlainJson(item, numberMode)])));
  }
}
