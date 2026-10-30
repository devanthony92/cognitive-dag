import { z } from 'zod';
import { defineNode, object } from './shared.js';

const MockConfigSchema = z.strictObject({
  latencyMs: z.number().int().min(0).max(30_000),
  failureRate: z.number().min(0).max(1),
  failureKind: z.enum(['transient', 'permanent', 'timeout']),
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
  },
  configSchema: MockConfigSchema,
  defaultConfig: () => ({
    latencyMs: 100,
    failureRate: 0,
    failureKind: 'transient',
  }),
  outputSchema: () => object({ ok: { kind: 'boolean' } }),
});
