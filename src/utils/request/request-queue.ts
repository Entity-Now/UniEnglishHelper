import { getRandomUUID } from '@/utils/crypto-polyfill';
import { BinaryHeapPQ } from './priority-queue';
import {
  defaultRequestRetryPolicy,
  type RequestRetryPolicy,
} from './retry-policy';

export interface RequestTask {
  id: string;
  thunk: () => Promise<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  scheduleAt: number;
  createdAt: number;
  retryCount: number;
  drained: boolean;
}

type QueuedRequestTask = RequestTask & { hash: string };

export interface QueueOptions {
  rate: number;
  capacity: number;
  timeoutMs: number;
  maxRetries: number;
  baseRetryDelayMs: number;
  retryPolicy?: RequestRetryPolicy;
}

function shallowMergeOptions(
  base: QueueOptions,
  partial: Partial<QueueOptions>,
): QueueOptions {
  return { ...base, ...partial };
}

export class RequestQueue {
  private waitingQueue: BinaryHeapPQ<QueuedRequestTask>;
  private waitingTasks = new Map<string, QueuedRequestTask>();
  private executingTasks = new Map<string, QueuedRequestTask>();
  private nextScheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private retryPolicy: RequestRetryPolicy;
  private bucketTokens: number;
  private lastRefill: number;

  constructor(private options: QueueOptions) {
    this.retryPolicy = options.retryPolicy ?? defaultRequestRetryPolicy;
    this.bucketTokens = options.capacity;
    this.lastRefill = Date.now();
    this.waitingQueue = new BinaryHeapPQ<QueuedRequestTask>();
  }

  enqueue<T>(thunk: () => Promise<T>, scheduleAt: number, hash: string): Promise<T> {
    const duplicateTask = this.duplicateTask(hash);
    if (duplicateTask) {
      return duplicateTask.promise as Promise<T>;
    }

    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const task: QueuedRequestTask = {
      id: getRandomUUID(),
      hash,
      thunk,
      promise,
      resolve: resolve as (value: unknown) => void,
      reject,
      scheduleAt,
      createdAt: Date.now(),
      retryCount: 0,
      drained: false,
    };

    this.waitingTasks.set(hash, task);
    this.waitingQueue.push(task, scheduleAt);
    this.schedule();
    return promise;
  }

  setQueueOptions(options: Partial<QueueOptions>) {
    const { retryPolicy, ...queueOptions } = options;
    this.options = shallowMergeOptions(this.options, queueOptions);
    if (retryPolicy) this.retryPolicy = retryPolicy;
    if (queueOptions.capacity != null) {
      this.bucketTokens = queueOptions.capacity;
      this.lastRefill = Date.now();
    }
  }

  private schedule() {
    this.refillTokens();

    while (this.bucketTokens >= 1 && this.waitingQueue.size() > 0) {
      const now = Date.now();
      const task = this.waitingQueue.peek();
      if (task && task.scheduleAt <= now) {
        this.waitingQueue.pop();
        this.waitingTasks.delete(task.hash);
        this.executingTasks.set(task.hash, task);
        this.bucketTokens -= 1;
        void this.executeTask(task);
      } else {
        break;
      }
    }

    if (this.nextScheduleTimer) {
      clearTimeout(this.nextScheduleTimer);
      this.nextScheduleTimer = null;
    }

    if (this.waitingQueue.size() > 0) {
      const nextTask = this.waitingQueue.peek();
      if (nextTask) {
        const now = Date.now();
        const delayUntilScheduled = Math.max(0, nextTask.scheduleAt - now);
        const msUntilNextToken =
          this.bucketTokens >= 1
            ? 0
            : Math.ceil(((1 - this.bucketTokens) / this.options.rate) * 1000);
        const delay = Math.max(delayUntilScheduled, msUntilNextToken);
        this.nextScheduleTimer = setTimeout(() => {
          this.nextScheduleTimer = null;
          this.schedule();
        }, delay);
      }
    }
  }

  private async executeTask(task: QueuedRequestTask) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `Task ${task.id} timed out after ${this.options.timeoutMs}ms`,
            ),
          );
        }, this.options.timeoutMs);
      });
      const result = await Promise.race([task.thunk(), timeoutPromise]);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (!task.drained) task.resolve(result);
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (task.drained) return;

      const now = Date.now();
      const decision = this.retryPolicy.decide(error, {
        retryCount: task.retryCount,
        maxRetries: this.options.maxRetries,
        baseRetryDelayMs: this.options.baseRetryDelayMs,
        now,
      });

      if (decision.action === 'retry') {
        task.retryCount += 1;
        task.scheduleAt = now + decision.delayMs;
        this.waitingTasks.set(task.hash, task);
        this.waitingQueue.push(task, task.scheduleAt);
        this.schedule();
      } else if (decision.failQueue) {
        this.failCurrentBacklog(error);
      } else {
        task.reject(error);
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (this.executingTasks.get(task.hash) === task) {
        this.executingTasks.delete(task.hash);
      }
      this.schedule();
    }
  }

  private duplicateTask(hash: string) {
    return this.waitingTasks.get(hash) ?? this.executingTasks.get(hash);
  }

  private failCurrentBacklog(error: unknown) {
    if (this.nextScheduleTimer) {
      clearTimeout(this.nextScheduleTimer);
      this.nextScheduleTimer = null;
    }
    for (const task of this.waitingTasks.values()) {
      this.rejectDrainedTask(task, error);
    }
    this.waitingTasks.clear();
    this.waitingQueue.clear();
    for (const task of this.executingTasks.values()) {
      this.rejectDrainedTask(task, error);
    }
    this.executingTasks.clear();
  }

  private rejectDrainedTask(task: QueuedRequestTask, error: unknown) {
    if (task.drained) return;
    task.drained = true;
    task.reject(error);
  }

  private refillTokens() {
    const now = Date.now();
    const timeSinceLastRefill = now - this.lastRefill;
    const tokensToAdd = (timeSinceLastRefill / 1000) * this.options.rate;
    this.bucketTokens = Math.min(
      this.bucketTokens + tokensToAdd,
      this.options.capacity,
    );
    this.lastRefill = now;
  }

  /** Snapshot for statistics UI. */
  getStats() {
    return {
      waiting: this.waitingTasks.size,
      executing: this.executingTasks.size,
      bucketTokens: this.bucketTokens,
      rate: this.options.rate,
      capacity: this.options.capacity,
    };
  }
}
