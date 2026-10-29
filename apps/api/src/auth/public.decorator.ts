import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:public';

/** Marks an endpoint that works without a session: health, public flags and authentication (FR-021). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
