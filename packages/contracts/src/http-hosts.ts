import { z } from 'zod';

/** Entries an organization may keep on its allowlist of destinations (F7, research R9.7). */
export const HTTP_ALLOWED_HOSTS_MAX = 100;

export const HttpAllowedHostSchema = z.object({
  id: z.uuid(),
  /** An exact host or `*.domain`. */
  pattern: z.string().min(4).max(253),
  createdAt: z.iso.datetime(),
});
export type HttpAllowedHost = z.infer<typeof HttpAllowedHostSchema>;

export const HttpAllowedHostListSchema = z.object({ items: z.array(HttpAllowedHostSchema) });
export type HttpAllowedHostList = z.infer<typeof HttpAllowedHostListSchema>;

/**
 * The grammar of the pattern (lower case, no IP, scheme, port or path) is checked by
 * `validateAllowlistEntry` in `@cognitive-dag/connectors`, the same code the client uses.
 */
export const AddHttpAllowedHostRequestSchema = z.strictObject({
  pattern: z.string().min(4).max(253),
});
export type AddHttpAllowedHostRequest = z.infer<typeof AddHttpAllowedHostRequestSchema>;
