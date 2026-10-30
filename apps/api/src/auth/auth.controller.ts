import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AcceptedResponse, SessionInfo } from '@cognitive-dag/contracts';
import {
  ChangePasswordDto,
  EmailDto,
  LoginDto,
  PasswordResetConfirmDto,
  RegisterDto,
  TokenDto,
} from './auth.dto';
import { IdentityEnabledGuard } from './identity-enabled.guard';
import { LoginService } from './login.service';
import { PasswordService } from './password.service';
import { Public } from './public.decorator';
import { CurrentAuth } from './request-context';
import { ACCEPTED_MESSAGE, RegistrationService } from './registration.service';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import {
  readCookie,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_OPTIONS,
} from './session-cookie';
import { SessionInfoService } from './session-info.service';
import { SessionService, type AuthSession } from './session.service';

const ACCEPTED: AcceptedResponse = { message: ACCEPTED_MESSAGE };

@Controller('api/v1/auth')
@UseGuards(IdentityEnabledGuard)
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly logins: LoginService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly sessionInfo: SessionInfoService,
    private readonly events: SecurityEventLogger,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(202)
  async register(@Body() body: RegisterDto, @Req() req: Request): Promise<AcceptedResponse> {
    await this.registration.register(body, clientIp(req));
    return ACCEPTED;
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body() body: TokenDto, @Req() req: Request): Promise<void> {
    await this.registration.verifyEmail(body.token, clientIp(req));
  }

  @Public()
  @Post('verify-email/resend')
  @HttpCode(202)
  async resend(@Body() body: EmailDto, @Req() req: Request): Promise<AcceptedResponse> {
    await this.registration.resendVerification(body.email, clientIp(req));
    return ACCEPTED;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionInfo> {
    const { session, info } = await this.logins.login(body, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      previousToken: readCookie(req, SESSION_COOKIE),
    });
    res.cookie(SESSION_COOKIE, session.token, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    });
    return info;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthSession,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await this.sessions.revoke(token, 'logout');
    res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    this.events.emit({
      event: 'auth.logout',
      outcome: 'success',
      userId: auth.userId,
      ip: clientIp(req),
    });
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(202)
  async requestPasswordReset(
    @Body() body: EmailDto,
    @Req() req: Request,
  ): Promise<AcceptedResponse> {
    await this.passwords.requestReset(body.email, clientIp(req));
    return ACCEPTED;
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmPasswordReset(
    @Body() body: PasswordResetConfirmDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.passwords.confirmReset(body.token, body.password, clientIp(req));
  }

  @Post('password/change')
  @HttpCode(204)
  async changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentAuth() auth: AuthSession,
    @Req() req: Request,
  ): Promise<void> {
    await this.passwords.change(auth, body.currentPassword, body.newPassword, clientIp(req));
  }

  @Get('session')
  session(@CurrentAuth() auth: AuthSession): Promise<SessionInfo> {
    return this.sessionInfo.build(auth.userId, auth.csrfToken);
  }
}

function clientIp(req: Request): string {
  return req.ip ?? 'unknown';
}
