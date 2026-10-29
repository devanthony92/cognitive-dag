import { createZodDto } from 'nestjs-zod';
import {
  EmailRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  TokenRequestSchema,
} from '@cognitive-dag/contracts';

export class RegisterDto extends createZodDto(RegisterRequestSchema) {}
export class TokenDto extends createZodDto(TokenRequestSchema) {}
export class EmailDto extends createZodDto(EmailRequestSchema) {}
export class LoginDto extends createZodDto(LoginRequestSchema) {}
