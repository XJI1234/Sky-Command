import { describe, expect, it } from 'vitest';
import { jsonFields, toPlainJson } from '../src/json.js';
import { RelayFrameCodec } from '../../src/modules/relay-link/protocol-core/index.js';

describe('SDK JSON boundary', () => {
  it('uses the existing wire codec, including prototype-like keys', () => {
    const source = JSON.parse('{"confirm":true,"nested":[1,null,"x"],"__proto__":{"value":2}}');
    const fields = jsonFields(source);
    expect(toPlainJson({ kind: 'object', fields })).toEqual(source);
    const encoded = RelayFrameCodec.encode({ type: 'command', id: 'test', command: { name: 'telemetry.read', fields } });
    expect(encoded.ok).toBe(true);
  });
  it('rejects values JSON would silently lose', () => {
    for (const value of [{ a: undefined }, { a: NaN }, { a: BigInt(1) }, { a: new Date() }]) {
      expect(() => jsonFields(value as never)).toThrow();
    }
    const cycle: Record<string, unknown> = {}; cycle.a = cycle;
    expect(() => jsonFields(cycle as never)).toThrow();
  });
  it('keeps large incoming decimal tokens as strings when requested', () => {
    expect(toPlainJson({ kind: 'number', value: '9007199254740993' }, 'string')).toBe('9007199254740993');
  });
});
