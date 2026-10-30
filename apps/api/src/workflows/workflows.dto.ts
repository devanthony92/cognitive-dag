import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  CreateWorkflowRequestSchema,
  PublishVersionRequestSchema,
  RenameWorkflowRequestSchema,
  SaveDraftRequestSchema,
} from '@cognitive-dag/contracts';

export class CreateWorkflowDto extends createZodDto(CreateWorkflowRequestSchema) {}
export class RenameWorkflowDto extends createZodDto(RenameWorkflowRequestSchema) {}
export class SaveDraftDto extends createZodDto(SaveDraftRequestSchema) {}

/** A missing body is a publication without a note. */
export class PublishVersionDto extends createZodDto(
  z.preprocess((body) => body ?? {}, PublishVersionRequestSchema),
) {}

export class WorkflowParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), workflowId: z.uuid() }),
) {}

export class VersionParamsDto extends createZodDto(
  z.object({
    organizationId: z.uuid(),
    workflowId: z.uuid(),
    versionNumber: z.coerce.number().int().min(1).max(2_147_483_647),
  }),
) {}
