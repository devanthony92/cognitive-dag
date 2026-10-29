import { z } from 'zod';

export const HealthCheckSchema = z.object({
  status: z.enum(['up', 'down']),
});

export const HealthReportSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), HealthCheckSchema).optional(),
});

export type HealthReport = z.infer<typeof HealthReportSchema>;
