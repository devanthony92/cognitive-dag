import type { ValkeyAuth } from './secrets';

/**
 * Connection options that come from the configuration and not from the URL: the user and password of
 * the ACL user, and the internal CA that verifies the server (`rediss://`). Without them the
 * development connection is unchanged.
 */
export function valkeyOptions(auth: ValkeyAuth | undefined): {
  username?: string;
  password?: string;
  tls?: { ca: string };
} {
  if (auth === undefined) return {};
  return {
    ...(auth.username ? { username: auth.username } : {}),
    ...(auth.password ? { password: auth.password } : {}),
    ...(auth.ca ? { tls: { ca: auth.ca } } : {}),
  };
}
