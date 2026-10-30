import { z } from 'zod';
import { ConditionSchema, type Condition } from '../conditions.js';
import { defineNode } from './shared.js';

const ConditionConfigSchema = z.strictObject({ condition: ConditionSchema });

export const logicCondition = defineNode({
  type: 'logic.condition' as const,
  label: 'Condición',
  description: 'Elige entre dos ramas según una condición tipada.',
  category: 'logic',
  executableFrom: 'F3',
  acceptsInput: true,
  handles: ['true', 'false'],
  templatableFields: [],
  fieldLabels: { condition: 'Condición' },
  configSchema: ConditionConfigSchema,
  defaultConfig: (): { condition: Condition } => ({
    condition: {
      op: 'eq',
      left: { kind: 'literal', type: 'boolean', value: true },
      right: { kind: 'literal', type: 'boolean', value: true },
    },
  }),
  outputSchema: () => null,
});
