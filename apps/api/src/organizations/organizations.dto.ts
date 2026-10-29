import { createZodDto } from 'nestjs-zod';
import { CreateOrganizationRequestSchema } from '@cognitive-dag/contracts';

export class CreateOrganizationDto extends createZodDto(CreateOrganizationRequestSchema) {}
