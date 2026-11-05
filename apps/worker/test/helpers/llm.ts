import type { Budget, CallRecord, Reservation } from '../../src/llm/budget';

/** In-memory budget: counts what the activities ask without touching PostgreSQL. */
export function memoryBudget(options: { failWith?: () => Error } = {}) {
  const reserved: number[] = [];
  const settled: CallRecord[] = [];
  const budget: Budget = {
    reserve: ({ tokens }) => {
      reserved.push(tokens);
      if (options.failWith) return Promise.reject(options.failWith());
      return Promise.resolve<Reservation>({ tokens, usageDate: '2026-11-05' });
    },
    settle: (call) => {
      settled.push(call);
      return Promise.resolve();
    },
  };
  return { budget, reserved, settled };
}

export const MODELS = {
  'llm.classify': 'test-lite',
  'llm.extract': 'test-lite',
  'llm.generate': 'test-flash',
} as const;

export const POLICY = { maxAttempts: 3, timeoutSeconds: 30, initialIntervalMs: 100 };
