import { z } from 'zod';
import { defineNode } from './shared.js';

const MergeConfigSchema = z.strictObject({ strategy: z.enum(['all', 'any']).default('all') });

export const logicMerge = defineNode({
  type: 'logic.merge' as const,
  label: 'Unir ramas',
  description: 'Espera a todas las ramas de entrada o a la primera que termine.',
  category: 'logic',
  executableFrom: 'F3',
  acceptsInput: true,
  handles: ['out'],
  templatableFields: [],
  configSchema: MergeConfigSchema,
  defaultConfig: () => ({ strategy: 'all' }),
  outputSchema: () => null,
});
