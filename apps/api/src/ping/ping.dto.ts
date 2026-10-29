import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  CreatePingRequestSchema,
  IdempotencyKeySchema,
  PingIdSchema,
} from '@cognitive-dag/contracts';

/** A missing body is an empty request: every field of the ping request is optional. */
export class CreatePingDto extends createZodDto(
  z.preprocess((body) => body ?? {}, CreatePingRequestSchema),
) {}

export const CreatePingHeadersSchema = z.object({
  'idempotency-key': IdempotencyKeySchema.optional(),
});

export class PingParamsDto extends createZodDto(z.object({ pingId: PingIdSchema })) {}
