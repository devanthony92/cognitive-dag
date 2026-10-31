import type { DagErrorBody, FieldError, ProblemCode } from '@cognitive-dag/contracts';

/** Expected application error, rendered as problem+json by ProblemDetailsFilter. */
export class DomainException extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly detail: string,
    readonly options: {
      errors?: FieldError[];
      dagErrors?: DagErrorBody[];
      retryAfterSeconds?: number;
      reason?: 'no_active_version' | 'archived' | 'unsupported_nodes';
      nodes?: { nodeId: string; type: string; executableFrom: string }[];
    } = {},
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

export class UnauthenticatedException extends DomainException {
  constructor() {
    super(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.');
  }
}

/** One body for a wrong password, an unknown email and an unverified account (FR-014). */
export class InvalidCredentialsException extends DomainException {
  constructor() {
    super(401, 'INVALID_CREDENTIALS', 'Las credenciales no son válidas.');
  }
}

export class CsrfRejectedException extends DomainException {
  constructor() {
    super(403, 'CSRF_REJECTED', 'La solicitud fue rechazada por seguridad. Recarga la página.');
  }
}

/** A member whose role does not allow the action. Non-members get NotFound instead (FR-018). */
export class ForbiddenRoleException extends DomainException {
  constructor() {
    super(403, 'FORBIDDEN', 'Tu rol no permite realizar esta acción.');
  }
}

/** Also what a resource of another organization looks like: nothing says it exists (FR-018). */
export class ResourceNotFoundException extends DomainException {
  constructor() {
    super(404, 'NOT_FOUND', 'No se encontró el recurso solicitado.');
  }
}

/** FR-024: the change would leave the organization without an active owner. */
export class LastOwnerException extends DomainException {
  constructor() {
    super(409, 'LAST_OWNER', 'La organización debe conservar al menos un owner.');
  }
}

export class AlreadyMemberException extends DomainException {
  constructor() {
    super(409, 'ALREADY_MEMBER', 'Esa persona ya es miembro de la organización.');
  }
}

/** The invitation is bound to an email (FR-023); another account cannot take it. */
export class InvitationForAnotherAccountException extends DomainException {
  constructor() {
    super(
      403,
      'FORBIDDEN',
      'Esta invitación es para otro correo. Inicia sesión con la cuenta invitada.',
    );
  }
}

export class WorkflowNameTakenException extends DomainException {
  constructor() {
    super(409, 'WORKFLOW_NAME_TAKEN', 'Ya existe un workflow con ese nombre en la organización.');
  }
}

/** The draft changed since the revision the client based its work on (R10). */
export class DraftConflictException extends DomainException {
  constructor(
    detail = 'El borrador cambió desde la revisión que usaste. Recárgalo para continuar.',
  ) {
    super(409, 'DRAFT_CONFLICT', detail);
  }
}

export class PreconditionRequiredException extends DomainException {
  constructor() {
    super(
      428,
      'PRECONDITION_REQUIRED',
      'Falta el encabezado If-Match con la revisión del borrador.',
    );
  }
}

/** Publishing a draft that does not pass the validation of `@cognitive-dag/dag-schema`. */
export class DagInvalidException extends DomainException {
  constructor(dagErrors: DagErrorBody[]) {
    super(422, 'DAG_INVALID', 'El borrador tiene errores y no se puede publicar.', { dagErrors });
  }
}

export class LimitExceededException extends DomainException {
  constructor(detail: string) {
    super(413, 'LIMIT_EXCEEDED', detail);
  }
}
