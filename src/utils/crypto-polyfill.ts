/**
 * Compatibility helpers for runtimes that expose crypto.getRandomValues()
 * without crypto.randomUUID().
 */

function getCryptoWithRandomValues(): Crypto {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new TypeError(
      '[crypto-polyfill] crypto.getRandomValues is required but not available.',
    );
  }
  return crypto;
}

export function generateUUIDv4(): string {
  const cryptoWithRandomValues = getCryptoWithRandomValues();
  const bytes = new Uint8Array(16);
  cryptoWithRandomValues.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function getRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return generateUUIDv4();
}
