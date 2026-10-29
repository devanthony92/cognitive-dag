import type { ProblemCode } from '@cognitive-dag/contracts';

/** Expected application error, rendered as problem+json by ProblemDetailsFilter. */
export class DomainException extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'DomainException';
  }
}

export class ServiceUnavailableException extends DomainException {
  constructor(
    detail = 'El servicio no está disponible temporalmente. Intenta de nuevo más tarde.',
  ) {
    super(503, 'SERVICE_UNAVAILABLE', detail);
  }
}
