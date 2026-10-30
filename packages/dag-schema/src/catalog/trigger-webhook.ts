import { z } from 'zod';
import { fieldListSchema, fieldsToObject, type FieldSpec } from '../types.js';
import { defineNode } from './shared.js';

const WebhookConfigSchema = z.strictObject({ bodySchema: fieldListSchema(50).default([]) });

export const triggerWebhook = defineNode({
  type: 'trigger.webhook' as const,
  label: 'Disparador por webhook',
  description: 'Inicia el workflow cuando llega una petición HTTP con el cuerpo esperado.',
  category: 'trigger',
  executableFrom: 'F7',
  acceptsInput: false,
  handles: ['out'],
  templatableFields: [],
  configSchema: WebhookConfigSchema,
  defaultConfig: () => ({ bodySchema: [] as FieldSpec[] }),
  outputSchema: (config: { bodySchema: FieldSpec[] }) => fieldsToObject(config.bodySchema),
});
