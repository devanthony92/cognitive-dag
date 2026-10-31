import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  RerunRequestSchema,
  RunStatusSchema,
  StartRunRequestSchema,
} from '@cognitive-dag/contracts';

export class StartRunDto extends createZodDto(StartRunRequestSchema) {}

// The body is optional: a rerun of the whole run sends none.
export class RerunDto extends createZodDto(
  z.preprocess((body) => body ?? {}, RerunRequestSchema) as unknown as typeof RerunRequestSchema,
) {}

export class WorkflowRunsParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), workflowId: z.uuid() }),
) {}

export class ListRunsQueryDto extends createZodDto(
  z.object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
) {}

export class OrganizationParamsDto extends createZodDto(z.object({ organizationId: z.uuid() })) {}

export class OrganizationRunsQueryDto extends createZodDto(
  z.object({
    status: RunStatusSchema.optional(),
    workflowId: z.uuid().optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
) {}

export class RunParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), runId: z.uuid() }),
) {}

export class StepIoParamsDto extends createZodDto(
  z.object({
    organizationId: z.uuid(),
    runId: z.uuid(),
    nodeId: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  }),
) {}
