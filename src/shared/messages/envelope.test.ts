import { describe, expect, it } from 'vitest';
import { createEnvelope, fail, isEnvelope, ok } from './envelope';

describe('envelope', () => {
  it('creates v1 envelope with requestId', () => {
    const env = createEnvelope({
      channel: 'runtime',
      type: 'sys.ping',
      source: 'popup',
      payload: {},
    });
    expect(env.v).toBe(1);
    expect(env.type).toBe('sys.ping');
    expect(env.requestId).toBeTruthy();
    expect(isEnvelope(env)).toBe(true);
  });

  it('ok/fail helpers', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(fail('UNKNOWN', 'x').ok).toBe(false);
  });

  it('rejects non-envelopes', () => {
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope({ type: 'x' })).toBe(false);
  });
});
