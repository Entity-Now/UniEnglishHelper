/**
 * Lightweight circuit breaker for LLM word-explain / chat calls.
 * After repeated failures (timeout, HTTP error, network), skip LLM briefly
 * so free MT can answer immediately.
 */

const FAILURE_THRESHOLD = 2;
const WINDOW_MS = 60_000;
/** Skip LLM for this long after the circuit opens. */
const OPEN_MS = 90_000;
/** Per-request budget for word explain (must feel snappy). */
export const LLM_WORD_EXPLAIN_TIMEOUT_MS = 3_500;

const failureTimestamps: number[] = [];
let circuitOpenUntil: number | null = null;

function prune(now: number): void {
  const floor = now - WINDOW_MS;
  while (failureTimestamps.length > 0 && failureTimestamps[0]! < floor) {
    failureTimestamps.shift();
  }
}

export function isLlmCircuitOpen(now = Date.now()): boolean {
  return Boolean(circuitOpenUntil && circuitOpenUntil > now);
}

export function getLlmCircuitOpenUntil(): number | null {
  return circuitOpenUntil;
}

export function recordLlmSuccess(): void {
  failureTimestamps.length = 0;
  circuitOpenUntil = null;
}

export function recordLlmFailure(now = Date.now()): void {
  prune(now);
  failureTimestamps.push(now);
  if (failureTimestamps.length >= FAILURE_THRESHOLD) {
    circuitOpenUntil = now + OPEN_MS;
    failureTimestamps.length = 0;
  }
}

export function resetLlmCircuit(): void {
  failureTimestamps.length = 0;
  circuitOpenUntil = null;
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
