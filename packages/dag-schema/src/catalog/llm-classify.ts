import { z } from 'zod';
import { LLM_RETRY_DEFAULTS, defineNode, redactPii, object, templateText } from './shared.js';

const ClassifyConfigSchema = z.strictObject({
  text: templateText(),
  labels: z
    .array(z.string().min(1).max(50))
    .min(2)
    .max(20)
    .refine(
      (labels) => new Set(labels).size === labels.length,
      'Las etiquetas no pueden repetirse.',
    ),
  redactPii: redactPii(),
});

export const llmClassify = defineNode({
  type: 'llm.classify' as const,
  label: 'Clasificar',
  description: 'Asigna un texto a una de las etiquetas permitidas.',
  category: 'llm',
  executableFrom: 'F5',
  retryDefaults: LLM_RETRY_DEFAULTS,
  acceptsInput: true,
  handles: ['out'],
  templatableFields: ['text'],
  fieldLabels: { text: 'Texto', labels: 'Etiquetas', redactPii: 'Ocultar datos personales' },
  itemLabels: { labels: 'La etiqueta' },
  configSchema: ClassifyConfigSchema,
  defaultConfig: () => ({
    text: 'Texto a clasificar',
    labels: ['positivo', 'negativo'],
    redactPii: false,
  }),
  outputSchema: (config: { labels: string[] }) =>
    object({
      label: { kind: 'enum', values: [...config.labels] },
      confidence: { kind: 'number', min: 0, max: 1 },
    }),
});
