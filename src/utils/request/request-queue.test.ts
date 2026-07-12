import { describe, expect, it } from 'vitest';
import { RequestQueue } from './request-queue';
import { BinaryHeapPQ } from './priority-queue';

describe('BinaryHeapPQ', () => {
  it('pops lowest priority first', () => {
    const pq = new BinaryHeapPQ<string>();
    pq.push('c', 30);
    pq.push('a', 10);
    pq.push('b', 20);
    expect(pq.pop()).toBe('a');
    expect(pq.pop()).toBe('b');
    expect(pq.pop()).toBe('c');
  });
});

describe('RequestQueue', () => {
  it('dedupes by hash and executes', async () => {
    const q = new RequestQueue({
      rate: 100,
      capacity: 10,
      timeoutMs: 2000,
      maxRetries: 0,
      baseRetryDelayMs: 10,
    });
    let runs = 0;
    const p1 = q.enqueue(async () => {
      runs += 1;
      return 42;
    }, Date.now(), 'same');
    const p2 = q.enqueue(async () => {
      runs += 1;
      return 99;
    }, Date.now(), 'same');
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(runs).toBe(1);
  });
});
