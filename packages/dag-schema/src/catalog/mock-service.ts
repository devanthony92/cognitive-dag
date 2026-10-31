import { z } from 'zod';
import { defineNode, object } from './shared.js';

const MockConfigSchema = z
  .strictObject({
    latencyMs: z.number().int().min(0).max(30_000),
    failureRate: z.number().min(0).max(1),
    failureKind: z.enum(['transient', 'permanent', 'timeout', 'rate_limited']),
    /** How long a `rate_limited` failure asks to wait before trying again. */
    retryAfterMs: z.number().int().min(0).max(60_000).optional(),
    /** Fails the first N attempts and then works, without chance (FR-014). */
    failFirstAttempts: z.number().int().min(0).max(10).optional(),
  })
  .superRefine((config, context) => {
    if (
      config.retryAfterMs !== undefined &&
      config.retryAfterMs > 0 &&
      config.failureKind !== 'rate_limited'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retryAfterMs'],
        message: 'La espera indicada solo se usa con el tipo de fallo «rate_limited».',
      });
    }
  });

export const mockService = defineNode({
  type: 'mock.service' as const,
  label: 'Servicio simulado',
  description: 'Simula un servicio con latencia y fallos configurables, para pruebas.',
  category: 'mock',
  executableFrom: 'F3',
  acceptsInput: true,
  handles: ['out'],
  templatableFields: [],
  fieldLabels: {
    latencyMs: 'Latencia (ms)',
    failureRate: 'Tasa de fallos (0 a 1)',
    failureKind: 'Tipo de fallo',
    retryAfterMs: 'Espera indicada (ms)',
    failFirstAttempts: 'Fallar los primeros intentos',
  },
  retryDefaults: { maxAttempts: 3, timeoutSeconds: 30, initialIntervalMs: 1000 },
  configSchema: MockConfigSchema,
  defaultConfig: () => ({
    latencyMs: 100,
    failureRate: 0,
    failureKind: 'transient',
  }),
  outputSchema: () => object({ ok: { kind: 'boolean' } }),
});
