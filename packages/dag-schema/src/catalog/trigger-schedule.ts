import { z } from 'zod';
import { defineNode, object } from './shared.js';

const CRON = /^[0-9*/,\-A-Za-z?#]+(?: [0-9*/,\-A-Za-z?#]+){4}$/;
const TIMEZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const ScheduleConfigSchema = z.strictObject({
  cron: z.string().max(100).regex(CRON, 'La expresión cron debe tener 5 campos.'),
  timezone: z.string().min(1).max(64).regex(TIMEZONE).default('UTC'),
});

export const triggerSchedule = defineNode({
  type: 'trigger.schedule' as const,
  label: 'Disparador programado',
  description: 'Inicia el workflow según una expresión cron y una zona horaria.',
  category: 'trigger',
  executableFrom: 'F7',
  acceptsInput: false,
  handles: ['out'],
  templatableFields: [],
  configSchema: ScheduleConfigSchema,
  defaultConfig: () => ({ cron: '0 9 * * *', timezone: 'UTC' }),
  outputSchema: () => object({ firedAt: { kind: 'datetime' } }),
});
