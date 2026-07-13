import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLlmCircuitOpenUntil,
  isLlmCircuitOpen,
  recordLlmFailure,
  recordLlmSuccess,
  resetLlmCircuit,
  withTimeout,
} from './llm-circuit';

describe('llm-circuit', () => {
  afterEach(() => {
    resetLlmCircuit();
    vi.useRealTimers();
  });

  it('opens after two failures and closes after success', () => {
    expect(isLlmCircuitOpen()).toBe(false);
    recordLlmFailure(1_000);
    expect(isLlmCircuitOpen(1_000)).toBe(false);
    recordLlmFailure(1_100);
    expect(isLlmCircuitOpen(1_100)).toBe(true);
    expect(getLlmCircuitOpenUntil()).toBeGreaterThan(1_100);

    recordLlmSuccess();
    expect(isLlmCircuitOpen()).toBe(false);
    expect(getLlmCircuitOpenUntil()).toBeNull();
  });

  it('withTimeout rejects after deadline', async () => {
    vi.useFakeTimers();
    const p = withTimeout(
      new Promise((resolve) => setTimeout(() => resolve('late'), 10_000)),
      50,
      'test',
    );
    const assertion = expect(p).rejects.toThrow(/test after 50ms/);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });
});
