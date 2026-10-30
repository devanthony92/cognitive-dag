import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DomainException, PreconditionRequiredException } from '../common/errors/domain.exception';

/** `"7"`, `W/"7"` or `7`: the revision of the draft as an entity tag (research R10). */
const REVISION = /^(?:W\/)?"?(\d{1,9})"?$/;

/** Parses the `If-Match` header; the draft revisions start at 1. */
export function parseIfMatch(header: string | undefined): number {
  if (header === undefined || header.trim() === '') throw new PreconditionRequiredException();
  const match = REVISION.exec(header.trim());
  const revision = match?.[1] === undefined ? 0 : Number(match[1]);
  if (revision < 1) {
    throw new DomainException(422, 'VALIDATION_FAILED', 'La solicitud contiene datos inválidos.', {
      errors: [
        { field: 'If-Match', message: 'Debe indicar la revisión del borrador, por ejemplo "3".' },
      ],
    });
  }
  return revision;
}

/** The revision of the draft the client based its work on. */
export const IfMatchRevision = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  parseIfMatch(context.switchToHttp().getRequest<Request>().headers['if-match']),
);
