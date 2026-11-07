import { z } from 'zod';
import { defineNode, object } from './shared.js';

const CRON = /^[0-9*/,\-A-Za-z?#]+(?: [0-9*/,\-A-Za-z?#]+){4}$/;
const TIMEZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * True for a zone of the IANA database (F7, research R6). The runtime constructor decides, so `UTC`
 * and the historic aliases pass. It also accepts any letter case, which Temporal does not, so a name
 * that differs from the canonical one only in case is refused.
 */
export function isIanaTimeZone(zone: string): boolean {
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions()
      .timeZone;
    return resolved === zone || resolved.toLowerCase() !== zone.toLowerCase();
  } catch {
    return false;
  }
}

const ScheduleConfigSchema = z.strictObject({
  cron: z.string().max(100).regex(CRON, 'La expresión cron debe tener 5 campos.'),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .regex(TIMEZONE)
    .superRefine((zone, ctx) => {
      // A malformed name is already reported by the pattern above.
      if (TIMEZONE.test(zone) && !isIanaTimeZone(zone)) {
        ctx.addIssue({
          code: 'custom',
          message: 'La zona horaria no existe en la base IANA (por ejemplo, «America/Bogota»).',
          params: { dagCode: 'SCHEDULE_TIMEZONE_INVALID' },
        });
      }
    })
    .default('UTC'),
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
  fieldLabels: { cron: 'Expresión cron', timezone: 'Zona horaria' },
  configSchema: ScheduleConfigSchema,
  defaultConfig: () => ({ cron: '0 9 * * *', timezone: 'UTC' }),
  outputSchema: () => object({ firedAt: { kind: 'datetime' } }),
});
