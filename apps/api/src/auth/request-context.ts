import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { UnauthenticatedException } from '../common/errors/domain.exception';
import type { RequestTenant } from '../organizations/tenant-context';
import type { AuthSession } from './session.service';

export type AppRequest = Request & { auth?: AuthSession; tenant?: RequestTenant };

/** The validated session. Absent only on public endpoints. */
export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<AppRequest>().auth;
  if (!auth) throw new UnauthenticatedException();
  return auth;
});

/** The organization of the request; undefined when no guard resolved one. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestTenant | undefined =>
    context.switchToHttp().getRequest<AppRequest>().tenant,
);
