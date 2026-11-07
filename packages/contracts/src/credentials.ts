import { z } from 'zod';
import { PersonRefSchema } from './primitives.js';

export const CredentialKindSchema = z.enum(['bearer', 'api_key_header', 'basic']);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

export const CREDENTIAL_NAME_MAX = 64;
export const CREDENTIAL_SECRET_MAX = 4096;

/**
 * Names an `api_key_header` credential may not use (F7, research R10), in lower case; `Proxy-*` is a
 * prefix rule. `@cognitive-dag/connectors` keeps the same list for the client; a test fixes both.
 */
export const FORBIDDEN_CREDENTIAL_HEADER_NAMES = [
  'host',
  'content-length',
  'content-type',
  'transfer-encoding',
  'connection',
  'cookie',
  'set-cookie',
  'authorization',
  'idempotency-key',
] as const;

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

/** Metadata of a credential. The secret is never part of a response. */
export const CredentialSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(CREDENTIAL_NAME_MAX),
  kind: CredentialKindSchema,
  /** Only for `api_key_header`. */
  headerName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: PersonRefSchema,
  rotatedAt: z.iso.datetime().nullable(),
});
export type Credential = z.infer<typeof CredentialSchema>;

export const CredentialListSchema = z.object({ items: z.array(CredentialSchema) });
export type CredentialList = z.infer<typeof CredentialListSchema>;

const SecretSchema = z.string().min(1).max(CREDENTIAL_SECRET_MAX);

export const CreateCredentialRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(CREDENTIAL_NAME_MAX),
    kind: CredentialKindSchema,
    headerName: z.string().optional(),
    /** For `basic` it is `user:password`. Encrypted on arrival and never returned. */
    secret: SecretSchema,
  })
  .superRefine((request, ctx) => {
    if (request.kind === 'api_key_header') {
      const name = request.headerName;
      if (name === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'El nombre de la cabecera es obligatorio.',
          path: ['headerName'],
        });
      } else if (
        !HEADER_NAME.test(name) ||
        (FORBIDDEN_CREDENTIAL_HEADER_NAMES as readonly string[]).includes(name.toLowerCase()) ||
        name.toLowerCase().startsWith('proxy-')
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Ese nombre de cabecera no está permitido.',
          path: ['headerName'],
        });
      }
    } else if (request.headerName !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Solo las credenciales de tipo api_key_header llevan nombre de cabecera.',
        path: ['headerName'],
      });
    }
    if (request.kind === 'basic' && request.secret.indexOf(':') < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'El secreto debe tener la forma «usuario:clave».',
        path: ['secret'],
      });
    }
  });
export type CreateCredentialRequest = z.infer<typeof CreateCredentialRequestSchema>;

export const RotateCredentialRequestSchema = z.strictObject({ secret: SecretSchema });
export type RotateCredentialRequest = z.infer<typeof RotateCredentialRequestSchema>;
