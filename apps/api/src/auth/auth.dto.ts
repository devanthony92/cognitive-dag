import { createZodDto } from 'nestjs-zod';
import {
  ChangePasswordRequestSchema,
  EmailRequestSchema,
  LoginRequestSchema,
  PasswordResetConfirmRequestSchema,
  RegisterRequestSchema,
  TokenRequestSchema,
} from '@cognitive-dag/contracts';

export class RegisterDto extends createZodDto(RegisterRequestSchema) {}
export class TokenDto extends createZodDto(TokenRequestSchema) {}
export class EmailDto extends createZodDto(EmailRequestSchema) {}
export class LoginDto extends createZodDto(LoginRequestSchema) {}
export class PasswordResetConfirmDto extends createZodDto(PasswordResetConfirmRequestSchema) {}
export class ChangePasswordDto extends createZodDto(ChangePasswordRequestSchema) {}
