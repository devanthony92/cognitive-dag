import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The intent is checked by the service, after trimming, so that an empty one and one that is too
 * long answer 400 with their own code (F6 contract) instead of the generic 422 of validation.
 */
export class CreateCompilationDto extends createZodDto(
  z.strictObject({ intent: z.string(), workflowId: z.uuid().optional() }),
) {}

export class ListCompilationsQueryDto extends createZodDto(
  z.object({ workflowId: z.uuid().optional() }),
) {}

export class CompilationParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), compilationId: z.uuid() }),
) {}
