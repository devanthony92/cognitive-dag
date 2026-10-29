import { ClsService } from 'nestjs-cls';
import { ZodValidationException } from 'nestjs-zod';
import { FEATURE_FLAGS, resolveCorrelationId, type PingExecution } from '@cognitive-dag/contracts';
import { FeatureNotAvailableException } from '../common/errors/domain.exception';
import { FlagsService } from '../flags/flags.service';
import { CreatePingHeadersSchema } from './ping.dto';
import { PingService } from './ping.service';

/** Shared by the F0 route and the organization route, so both validate and gate the same way. */
export async function createPing(
  deps: { pings: PingService; flags: FlagsService; cls: ClsService },
  input: { rawHeaders: Record<string, unknown>; message?: string; organizationId?: string },
): Promise<PingExecution> {
  // Nest pipes skip @Headers(), so the header is validated here and reported as 422.
  const headers = CreatePingHeadersSchema.safeParse(input.rawHeaders);
  if (!headers.success) throw new ZodValidationException(headers.error);
  // The flag gates the feature before any workflow starts (constitution, principle VIII).
  if (!(await deps.flags.isEnabled(FEATURE_FLAGS.pingEnabled))) {
    throw new FeatureNotAvailableException();
  }
  return deps.pings.create({
    correlationId: resolveCorrelationId(deps.cls.getId()),
    idempotencyKey: headers.data['idempotency-key'],
    ...(input.message === undefined ? {} : { message: input.message }),
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
  });
}
