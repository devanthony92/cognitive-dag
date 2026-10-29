import { STATUS_CODES } from 'node:http';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import {
  PROBLEM_CONTENT_TYPE,
  resolveCorrelationId,
  type FieldError,
  type ProblemCode,
  type ProblemDetails,
} from '@cognitive-dag/contracts';
import { DomainException } from './domain.exception';

interface MappedProblem {
  status: number;
  code: ProblemCode;
  detail: string;
  errors?: FieldError[];
  retryAfterSeconds?: number;
}

/** Body-parser errors carry a `type` instead of being HttpExceptions. */
interface BodyParserError {
  type: string;
  status: number;
}

const GENERIC_SERVER_ERROR = 'Ocurrió un error inesperado. Usa el correlationId para reportarlo.';

/**
 * Single place where API errors are rendered (constitution, principle V): RFC 9457 problem+json
 * without `type`/`instance`. Server errors never expose internal details.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    private readonly cls: ClsService,
    @InjectPinoLogger(ProblemDetailsFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = this.map(exception);
    const correlationId = resolveCorrelationId(this.cls.getId());

    if (mapped.status >= 500) {
      this.logger.error({ err: exception, correlationId }, 'Request failed with a server error');
    }

    const body: ProblemDetails = {
      status: mapped.status,
      title: STATUS_CODES[mapped.status] ?? 'Error',
      detail: mapped.detail,
      code: mapped.code,
      correlationId,
      ...(mapped.errors ? { errors: mapped.errors } : {}),
      ...(mapped.retryAfterSeconds ? { retryAfterSeconds: mapped.retryAfterSeconds } : {}),
    };

    if (mapped.retryAfterSeconds) response.setHeader('Retry-After', mapped.retryAfterSeconds);
    response.status(mapped.status).type(PROBLEM_CONTENT_TYPE).json(body);
  }

  private map(exception: unknown): MappedProblem {
    if (exception instanceof DomainException) {
      return {
        status: exception.status,
        code: exception.code,
        detail: exception.detail,
        ...exception.options,
      };
    }
    if (exception instanceof ZodValidationException) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'VALIDATION_FAILED',
        detail: 'La solicitud contiene datos inválidos.',
        errors: toFieldErrors(exception.getZodError() as ZodError),
      };
    }
    if (isBodyParserError(exception, 'entity.too.large')) {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'PAYLOAD_TOO_LARGE',
        detail: 'El cuerpo de la solicitud supera el tamaño máximo permitido.',
      };
    }
    // Malformed JSON surfaces either as the raw parser error or wrapped by Nest as a 400.
    if (
      isBodyParserError(exception, 'entity.parse.failed') ||
      (exception instanceof HttpException && exception.getStatus() === 400)
    ) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'VALIDATION_FAILED',
        detail: 'La solicitud contiene datos inválidos.',
        errors: [{ field: '(body)', message: 'La solicitud no tiene un formato válido.' }],
      };
    }
    if (exception instanceof HttpException && exception.getStatus() === 404) {
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'ROUTE_NOT_FOUND',
        detail: 'La ruta solicitada no existe.',
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      detail: GENERIC_SERVER_ERROR,
    };
  }
}

function toFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(body)',
    message: issue.message,
  }));
}

function isBodyParserError(exception: unknown, type: string): exception is BodyParserError {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    (exception as Partial<BodyParserError>).type === type
  );
}
