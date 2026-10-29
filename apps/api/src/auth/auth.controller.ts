import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AcceptedResponse } from '@cognitive-dag/contracts';
import { EmailDto, RegisterDto, TokenDto } from './auth.dto';
import { IdentityEnabledGuard } from './identity-enabled.guard';
import { ACCEPTED_MESSAGE, RegistrationService } from './registration.service';

const ACCEPTED: AcceptedResponse = { message: ACCEPTED_MESSAGE };

@Controller('api/v1/auth')
@UseGuards(IdentityEnabledGuard)
export class AuthController {
  constructor(private readonly registration: RegistrationService) {}

  @Post('register')
  @HttpCode(202)
  async register(@Body() body: RegisterDto, @Req() req: Request): Promise<AcceptedResponse> {
    await this.registration.register(body, clientIp(req));
    return ACCEPTED;
  }

  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body() body: TokenDto, @Req() req: Request): Promise<void> {
    await this.registration.verifyEmail(body.token, clientIp(req));
  }

  @Post('verify-email/resend')
  @HttpCode(202)
  async resend(@Body() body: EmailDto, @Req() req: Request): Promise<AcceptedResponse> {
    await this.registration.resendVerification(body.email, clientIp(req));
    return ACCEPTED;
  }
}

function clientIp(req: Request): string {
  return req.ip ?? 'unknown';
}
