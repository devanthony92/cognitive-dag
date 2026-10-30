import { z } from 'zod';
import { fieldListSchema, fieldsToObject, type FieldSpec } from '../types.js';
import { defineNode } from './shared.js';

const ManualConfigSchema = z.strictObject({ inputSchema: fieldListSchema(50).default([]) });

export const triggerManual = defineNode({
  type: 'trigger.manual' as const,
  label: 'Disparador manual',
  description: 'Inicia el workflow a mano con los datos de entrada que declares.',
  category: 'trigger',
  executableFrom: 'F3',
  acceptsInput: false,
  handles: ['out'],
  templatableFields: [],
  configSchema: ManualConfigSchema,
  defaultConfig: () => ({ inputSchema: [] as FieldSpec[] }),
  outputSchema: (config: { inputSchema: FieldSpec[] }) => fieldsToObject(config.inputSchema),
});
