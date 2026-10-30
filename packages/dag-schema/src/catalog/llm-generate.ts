import { z } from 'zod';
import { defineNode, object, templateText } from './shared.js';

const GenerateConfigSchema = z.strictObject({
  instruction: templateText(),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default('es'),
  maxLength: z.number().int().min(1).max(10_000).default(1000),
});

export const llmGenerate = defineNode({
  type: 'llm.generate' as const,
  label: 'Generar texto',
  description: 'Genera un texto a partir de una instrucción.',
  category: 'llm',
  executableFrom: 'F5',
  acceptsInput: true,
  handles: ['out'],
  templatableFields: ['instruction'],
  fieldLabels: { instruction: 'Instrucción', language: 'Idioma', maxLength: 'Longitud máxima' },
  configSchema: GenerateConfigSchema,
  defaultConfig: () => ({ instruction: 'Escribe un resumen.', language: 'es', maxLength: 1000 }),
  outputSchema: () => object({ text: { kind: 'string' } }),
});
