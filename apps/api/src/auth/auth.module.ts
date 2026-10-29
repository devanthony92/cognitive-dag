import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthController } from './auth.controller';
import { CsrfGuard } from './csrf.guard';
import { IdentityEnabledGuard } from './identity-enabled.guard';
import { LoginService } from './login.service';
import { OneTimeTokenService } from './one-time-token.service';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy';
import { RegistrationService } from './registration.service';
import { SessionCache } from './session.cache';
import { SessionGuard } from './session.guard';
import { SessionInfoService } from './session-info.service';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [AuthController],
  providers: [
    IdentityEnabledGuard,
    LoginService,
    OneTimeTokenService,
    PasswordHasher,
    PasswordPolicy,
    RegistrationService,
    SessionCache,
    SessionInfoService,
    SessionRepository,
    SessionService,
    // Global and in this order: the session is resolved before the CSRF token is checked.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AuthModule {}
