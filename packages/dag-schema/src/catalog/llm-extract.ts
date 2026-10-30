import { z } from 'zod';
import { fieldListSchema, fieldsToObject, type FieldSpec } from '../types.js';
import { defineNode, templateText } from './shared.js';

const ExtractConfigSchema = z.strictObject({
  text: templateText(),
  fields: fieldListSchema(30, 1),
});

export const llmExtract = defineNode({
  type: 'llm.extract' as const,
  label: 'Extraer datos',
  description: 'Extrae campos tipados de un texto.',
  category: 'llm',
  executableFrom: 'F5',
  acceptsInput: true,
  handles: ['out'],
  templatableFields: ['text'],
  fieldLabels: { text: 'Texto', fields: 'Campos a extraer' },
  itemLabels: { fields: 'El campo' },
  configSchema: ExtractConfigSchema,
  defaultConfig: () => ({
    text: 'Texto del que extraer datos',
    fields: [{ name: 'campo', type: { kind: 'string' } }] as FieldSpec[],
  }),
  outputSchema: (config: { fields: FieldSpec[] }) => fieldsToObject(config.fields),
});
