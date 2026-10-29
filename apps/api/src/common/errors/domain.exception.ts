import type { FieldError, ProblemCode } from '@cognitive-dag/contracts';

/** Expected application error, rendered as problem+json by ProblemDetailsFilter. */
export class DomainException extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly detail: string,
    readonly options: { errors?: FieldError[]; retryAfterSeconds?: number } = {},
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

/** Generic anti-enumeration and expected-failure helpers used by the identity endpoints. */
export class FeatureNotAvailableException extends DomainException {
  constructor() {
    super(404, 'FEATURE_NOT_AVAILABLE', 'Esta funcionalidad no está disponible.');
  }
}

export class RateLimitedException extends DomainException {
  constructor(retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', 'Demasiados intentos. Espera antes de volver a intentarlo.', {
      retryAfterSeconds,
    });
  }
}

export class TokenInvalidException extends DomainException {
  constructor() {
    super(422, 'TOKEN_INVALID', 'El enlace no es válido, ya fue usado o está vencido.');
  }
}
