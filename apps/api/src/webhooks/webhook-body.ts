import type { Request } from 'express';
import { DomainException } from '../common/errors/domain.exception';

const isJsonContentType = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const mediaType = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
};

const tooLarge = () =>
  new DomainException(
    413,
    'PAYLOAD_TOO_LARGE',
    'El cuerpo de la solicitud supera el tamaño máximo permitido.',
  );

/**
 * Reads the body of a webhook after the token was accepted (the global parser skips this route, so
 * nobody is read without being authenticated first). The size is capped while reading the stream,
 * not only through `Content-Length`, which a client can omit or lie about.
 */
export async function readWebhookBody(req: Request, maxBytes: number): Promise<unknown> {
  if (!isJsonContentType(req.headers['content-type'])) {
    throw new DomainException(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'El webhook solo acepta cuerpos application/json.',
    );
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const piece = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += piece.length;
    if (size > maxBytes) throw tooLarge();
    chunks.push(piece);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainException(422, 'VALIDATION_FAILED', 'La solicitud contiene datos inválidos.', {
      errors: [{ field: '(body)', message: 'El cuerpo no es un JSON válido.' }],
    });
  }
}
