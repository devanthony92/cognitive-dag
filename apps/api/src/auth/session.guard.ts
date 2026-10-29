import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_FLAGS, TOKEN_LENGTH } from '@cognitive-dag/contracts';
import { UnauthenticatedException } from '../common/errors/domain.exception';
import { FlagsService } from '../flags/flags.service';
import { IS_PUBLIC } from './public.decorator';
import type { AppRequest } from './request-context';
import { readCookie, SESSION_COOKIE } from './session-cookie';
import { SessionService } from './session.service';

const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`);

/**
 * Global guard (FR-021): every endpoint needs a valid session unless it is marked `@Public()`.
 * With `identity-enabled` off nothing changes for the F0 endpoints, so it lets requests through;
 * the F1 controllers answer 404 FEATURE_NOT_AVAILABLE on their own in that case.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FlagsService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.identityEnabled))) return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const token = readCookie(request, SESSION_COOKIE);
    // A malformed cookie cannot be a session: skip the database round trip.
    if (token === undefined || !TOKEN_SHAPE.test(token)) throw new UnauthenticatedException();
    request.auth = await this.sessions.authenticate(token);
    return true;
  }
}
