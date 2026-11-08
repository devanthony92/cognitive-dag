import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class OrganizationOnlyParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid() }),
) {}

export class WorkflowTriggerParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), workflowId: z.uuid() }),
) {}
