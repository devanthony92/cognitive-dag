import { createZodDto } from 'nestjs-zod';
import {
  EmailRequestSchema,
  RegisterRequestSchema,
  TokenRequestSchema,
} from '@cognitive-dag/contracts';

export class RegisterDto extends createZodDto(RegisterRequestSchema) {}
export class TokenDto extends createZodDto(TokenRequestSchema) {}
export class EmailDto extends createZodDto(EmailRequestSchema) {}
