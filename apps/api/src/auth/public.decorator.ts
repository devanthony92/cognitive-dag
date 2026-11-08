import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:public';

/** Marks an endpoint that works without a session: health, public flags and authentication (FR-021). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SKIP_CSRF = 'auth:skip-csrf';

/** The endpoint authenticates by something other than a cookie (the webhook token), so CSRF does not apply. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);
