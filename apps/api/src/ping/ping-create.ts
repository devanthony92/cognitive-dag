import { ClsService } from 'nestjs-cls';
import { ZodValidationException } from 'nestjs-zod';
import { resolveCorrelationId, type PingExecution } from '@cognitive-dag/contracts';
import { CreatePingHeadersSchema } from './ping.dto';
import { PingService } from './ping.service';

/** Validates the headers of the organization ping and starts it. */
export async function createPing(
  deps: { pings: PingService; cls: ClsService },
  input: { rawHeaders: Record<string, unknown>; message?: string; organizationId?: string },
): Promise<PingExecution> {
  // Nest pipes skip @Headers(), so the header is validated here and reported as 422.
  const headers = CreatePingHeadersSchema.safeParse(input.rawHeaders);
  if (!headers.success) throw new ZodValidationException(headers.error);
  return deps.pings.create({
    correlationId: resolveCorrelationId(deps.cls.getId()),
    idempotencyKey: headers.data['idempotency-key'],
    ...(input.message === undefined ? {} : { message: input.message }),
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
  });
}
