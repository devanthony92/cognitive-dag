import { z } from 'zod';
import { defineNode, object, templateText } from './shared.js';

const ApprovalConfigSchema = z.strictObject({
  message: templateText(2000),
  timeoutSeconds: z.number().int().min(60).max(2_592_000).default(86_400),
});

export const humanApproval = defineNode({
  type: 'human.approval' as const,
  label: 'Aprobación humana',
  description: 'Pausa el workflow hasta que una persona apruebe o rechace, o venza el plazo.',
  category: 'human',
  executableFrom: 'F7',
  acceptsInput: true,
  handles: ['approved', 'rejected', 'timeout'],
  templatableFields: ['message'],
  configSchema: ApprovalConfigSchema,
  defaultConfig: () => ({ message: 'Revisa y aprueba para continuar.', timeoutSeconds: 86_400 }),
  outputSchema: () =>
    object({
      decision: { kind: 'enum', values: ['approved', 'rejected', 'timeout'] },
      approvedBy: { kind: 'string' },
    }),
});
