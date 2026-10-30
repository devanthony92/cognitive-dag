import { z } from 'zod';
import { defineNode, object, templateText } from './shared.js';

const HTTPS_URL = /^https:\/\/[^\s/{}@?#:]+(?::\d{1,5})?(?:[/?#]\S*)?$/i;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const SECRET_HEADER_NAME =
  /(authorization|cookie|token|secret|password|passwd|credential|auth|api[-_]?key)/i;
const CREDENTIAL_VALUE = /^\s*(bearer|basic|digest|token)\s+\S+/i;
function failWith(ctx: z.RefinementCtx, dagCode: string, message: string): void {
  ctx.addIssue({ code: 'custom', message, params: { dagCode } });
}
const HeadersSchema = z
  .record(z.string(), z.string().max(1000))
  .superRefine((headers, ctx) => {
    const entries = Object.entries(headers);
    if (entries.length > 20)
      failWith(ctx, 'SCHEMA_INVALID', 'Se permiten como máximo 20 cabeceras.');
    for (const [name, value] of entries) {
      if (!HEADER_NAME.test(name)) {
        failWith(ctx, 'SCHEMA_INVALID', `El nombre de cabecera «${name}» no es válido.`);
      } else if (SECRET_HEADER_NAME.test(name) || CREDENTIAL_VALUE.test(value)) {
        failWith(
          ctx,
          'HTTP_HEADER_FORBIDDEN',
          `La cabecera «${name}» no está permitida: las credenciales no pueden ir en la definición.`,
        );
      }
    }
  })
  .default({});
const HttpConfigSchema = z.strictObject({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: templateText(2000).superRefine((url, ctx) => {
    if (!HTTPS_URL.test(url)) {
      failWith(
        ctx,
        'HTTP_URL_NOT_HTTPS',
        'La URL debe usar https, sin usuario ni contraseña, y el servidor no puede ser una plantilla.',
      );
    }
  }),
  headers: HeadersSchema,
  body: z.string().max(20_000).default(''),
});

export const httpRequest = defineNode({
  type: 'http.request' as const,
  label: 'Petición HTTP',
  description: 'Llama a una API externa por https, sin credenciales en la definición.',
  category: 'integration',
  executableFrom: 'F7',
  acceptsInput: true,
  handles: ['out'],
  templatableFields: ['url', 'body'],
  fieldLabels: { method: 'Método', url: 'URL', headers: 'Cabeceras', body: 'Cuerpo' },
  itemLabels: { headers: 'La cabecera' },
  configSchema: HttpConfigSchema,
  defaultConfig: () => ({
    method: 'GET',
    url: 'https://example.com',
    headers: {},
    body: '',
  }),
  outputSchema: () => object({ status: { kind: 'number' }, body: { kind: 'string' } }),
});
