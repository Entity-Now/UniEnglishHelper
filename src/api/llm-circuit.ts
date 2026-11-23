/**
 * Lightweight per-provider circuit breaker for LLM word-explain / chat calls.
 * After repeated failures (timeout, HTTP error, network), skip LLM briefly
 * for that provider so free MT or another provider can answer immediately.
 */

const FAILURE_THRESHOLD = 2;
const WINDOW_MS = 60_000;
/** Skip LLM for this long after the circuit opens. */
const OPEN_MS = 60_000;
/** Per-request budget for word explain. */
export const LLM_WORD_EXPLAIN_TIMEOUT_MS = 20_000;
/** Timeout budget for explicit manual re-translate. */
export const LLM_RETRY_TIMEOUT_MS = 35_000;

const DEFAULT_CIRCUIT_KEY = '__default__';

interface CircuitState {
  failureTimestamps: number[];
  openUntil: number | null;
}

const circuits = new Map<string, CircuitState>();

function getCircuit(key: string): CircuitState {
  const normalized = key.trim() || DEFAULT_CIRCUIT_KEY;
  let state = circuits.get(normalized);
  if (!state) {
    state = { failureTimestamps: [], openUntil: null };
    circuits.set(normalized, state);
  }
  return state;
}

function prune(state: CircuitState, now: number): void {
  const floor = now - WINDOW_MS;
  while (state.failureTimestamps.length > 0 && state.failureTimestamps[0]! < floor) {
    state.failureTimestamps.shift();
  }
}

export function isLlmCircuitOpen(
  now = Date.now(),
  providerKey = DEFAULT_CIRCUIT_KEY,
): boolean {
  const state = circuits.get(providerKey.trim() || DEFAULT_CIRCUIT_KEY);
  return Boolean(state?.openUntil && state.openUntil > now);
}

export function getLlmCircuitOpenUntil(
  providerKey = DEFAULT_CIRCUIT_KEY,
): number | null {
  return circuits.get(providerKey.trim() || DEFAULT_CIRCUIT_KEY)?.openUntil ?? null;
}

export function recordLlmSuccess(providerKey = DEFAULT_CIRCUIT_KEY): void {
  const state = getCircuit(providerKey);
  state.failureTimestamps.length = 0;
  state.openUntil = null;
}

export function recordLlmFailure(
  now = Date.now(),
  providerKey = DEFAULT_CIRCUIT_KEY,
): void {
  const state = getCircuit(providerKey);
  prune(state, now);
  state.failureTimestamps.push(now);
  if (state.failureTimestamps.length >= FAILURE_THRESHOLD) {
    state.openUntil = now + OPEN_MS;
    state.failureTimestamps.length = 0;
  }
}

export function resetLlmCircuit(providerKey?: string): void {
  if (!providerKey) {
    circuits.clear();
    return;
  }
  circuits.delete(providerKey.trim() || DEFAULT_CIRCUIT_KEY);
}

/** Combine multiple AbortSignals so aborting any one aborts the returned signal. */
export function combineAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): { signal: AbortSignal; cleanup: () => void } {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (active.length === 0) {
    return { signal: new AbortController().signal, cleanup: () => {} };
  }
  if (active.length === 1) {
    return { signal: active[0]!, cleanup: () => {} };
  }
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any(active), cleanup: () => {} };
  }

  const ac = new AbortController();
  const listeners: Array<() => void> = [];
  for (const s of active) {
    if (s.aborted) {
      ac.abort(s.reason);
      return { signal: ac.signal, cleanup: () => {} };
    }
    const onAbort = () => ac.abort(s.reason);
    s.addEventListener('abort', onAbort, { once: true });
    listeners.push(() => s.removeEventListener('abort', onAbort));
  }
  return {
    signal: ac.signal,
    cleanup: () => {
      for (const remove of listeners) remove();
    },
  };
}

/** Race a promise against a wall-clock timeout (rejects on timeout). */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'timeout',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Run work with AbortController + timeout. Caller should pass signal into fetch.
 */
export async function withAbortTimeout<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
  label = 'LLM request',
): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await withTimeout(run(ac.signal), ms + 50, label);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run streaming work with AbortController + sliding inactivity timeout.
 * As long as notifyActivity() is called (e.g. on token chunks), the timeout is extended.
 * Throttles timer resets to at most once per second to avoid timer churn on high-TPS local models.
 */
export async function withStreamingTimeout<T>(
  initialTimeoutMs: number,
  run: (signal: AbortSignal, notifyActivity: () => void) => Promise<T>,
  inactivityLimitMs = 25_000,
): Promise<T> {
  const ac = new AbortController();
  let lastResetAt = 0;
  let timer = setTimeout(() => {
    ac.abort();
  }, initialTimeoutMs);

  const notifyActivity = () => {
    const now = Date.now();
    if (lastResetAt > 0 && now - lastResetAt < 1_000) return;
    lastResetAt = now;
    clearTimeout(timer);
    timer = setTimeout(() => {
      ac.abort();
    }, inactivityLimitMs);
  };

  try {
    return await run(ac.signal, notifyActivity);
  } finally {
    clearTimeout(timer);
  }
}
