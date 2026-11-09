/**
 * Base of every API URL. In production the web and the API share the origin (F9, D6A), so
 * `VITE_API_URL` is empty and every path stays relative (`/api/v1/...`): the same image works under
 * any domain. In development it points at the API port. A trailing slash is dropped so `base + path`
 * never doubles it. The variable is read on each call, which lets tests change it.
 */
export function apiBase(): string {
  const value = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? '';
  return value.replace(/\/+$/, '');
}

/** URL of an API path such as `/api/v1/auth/session`, used by `fetch` and by `EventSource`. */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}
