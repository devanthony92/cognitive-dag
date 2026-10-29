import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { IdentityEnabledGuard } from './identity-enabled.guard';
import { OneTimeTokenService } from './one-time-token.service';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy';
import { RegistrationService } from './registration.service';

@Module({
  controllers: [AuthController],
  providers: [
    IdentityEnabledGuard,
    OneTimeTokenService,
    PasswordHasher,
    PasswordPolicy,
    RegistrationService,
  ],
})
export class AuthModule {}
