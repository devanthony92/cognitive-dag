const HOOK_PREFIX = '/api/v1/hooks/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const HOOK_PATH_REDACTED = '[REDACTED]';

/**
 * Hides the token of a webhook URL (F7, SC-003). The token travels in the path, so every place
 * that writes a request URL (access log, traces, error reports) goes through this function.
 * Whatever follows the trigger id is dropped, and a first segment that is not a trigger id is
 * dropped too: a token put in the wrong place must not leak either.
 */
export function redactHookPath(url: string): string {
  const start = url.indexOf(HOOK_PREFIX);
  if (start === -1) return url;
  const afterPrefix = start + HOOK_PREFIX.length;
  const rest = url.slice(afterPrefix);
  const queryAt = rest.search(/[?#]/);
  const path = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const suffix = queryAt === -1 ? '' : rest.slice(queryAt);
  const [first = '', ...others] = path.split('/');
  if (!UUID.test(first)) return `${url.slice(0, afterPrefix)}${HOOK_PATH_REDACTED}${suffix}`;
  return `${url.slice(0, afterPrefix)}${first}/${others.length > 0 ? HOOK_PATH_REDACTED : ''}${suffix}`;
}

/** What an access-log line says about a request: the URL passes through the webhook redaction (SC-003). */
export const serializeRequest = (req: { method: string; url: string }) => ({
  method: req.method,
  url: redactHookPath(req.url),
});
