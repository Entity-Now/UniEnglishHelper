/** Non-functional budgets (ARCHITECTURE § NFR). */
export const NFR = {
  /** Ring buffer RAM target on reference laptop */
  ringMemoryMbMax: 12,
  /** Clip export p95 for ≤10s media window */
  exportP95Ms: 1000,
  /** S2 hard gate: beep onset error */
  clipAlignmentMsMax: 100,
  /** Free MT latency aspirational (cache miss) */
  translateP50Ms: 400,
  /** Anchor sample interval while playing */
  anchorIntervalMs: 80,
  /** Subtitle progress event rate when enabled */
  subtitleProgressHz: 4,
} as const;
