import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { CSRF_HEADER, FEATURE_FLAGS } from '@cognitive-dag/contracts';
import { CsrfRejectedException } from '../common/errors/domain.exception';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { FlagsService } from '../flags/flags.service';
import type { AppRequest } from './request-context';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for every state-changing request (FR-010, R6), on top of SameSite=Lax:
 * with a session, `Origin` must equal WEB_ORIGIN and `X-CSRF-Token` must match the session's token
 * (constant-time). Without one (login, register), a browser-sent `Origin` must still be ours.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly flags: FlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.identityEnabled))) return true;

    const origin = request.headers.origin;
    if (!request.auth) {
      if (origin !== undefined && origin !== this.config.WEB_ORIGIN) {
        throw new CsrfRejectedException();
      }
      return true;
    }

    if (origin !== this.config.WEB_ORIGIN) throw new CsrfRejectedException();
    const header = request.headers[CSRF_HEADER.toLowerCase()];
    if (typeof header !== 'string' || header === '') throw new CsrfRejectedException();
    const presented = createHash('sha256').update(header, 'utf8').digest();
    if (!timingSafeEqual(presented, request.auth.csrfTokenHash)) throw new CsrfRejectedException();
    return true;
  }
}
