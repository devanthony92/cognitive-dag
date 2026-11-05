import { z } from 'zod';
import { fieldListSchema, fieldsToObject, type FieldSpec } from '../types.js';
import { LLM_RETRY_DEFAULTS, defineNode, redactPii, templateText } from './shared.js';

const ExtractConfigSchema = z.strictObject({
  text: templateText(),
  fields: fieldListSchema(30, 1),
  redactPii: redactPii(),
});

export const llmExtract = defineNode({
  type: 'llm.extract' as const,
  label: 'Extraer datos',
  description: 'Extrae campos tipados de un texto.',
  category: 'llm',
  executableFrom: 'F5',
  retryDefaults: LLM_RETRY_DEFAULTS,
  acceptsInput: true,
  handles: ['out'],
  templatableFields: ['text'],
  fieldLabels: {
    text: 'Texto',
    fields: 'Campos a extraer',
    redactPii: 'Ocultar datos personales',
  },
  itemLabels: { fields: 'El campo' },
  configSchema: ExtractConfigSchema,
  defaultConfig: () => ({
    text: 'Texto del que extraer datos',
    fields: [{ name: 'campo', type: { kind: 'string' } }] as FieldSpec[],
    redactPii: false,
  }),
  outputSchema: (config: { fields: FieldSpec[] }) => fieldsToObject(config.fields),
});
