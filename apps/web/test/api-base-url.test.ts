import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { request } from '../src/api/client';
import { apiUrl } from '../src/api/base-url';
import { runEventsUrl } from '../src/features/runs/api';

const ORGANIZATION_ID = '0192f0a0-0000-7000-8000-0000000000aa';
const RUN_ID = '0192f0a0-0000-7000-8000-0000000000bb';

function stubFetch() {
  const mock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response('{}', { status: 200 })),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('API base URL (F9, FR-006)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('with VITE_API_URL empty (production: same origin)', () => {
    it('uses relative paths for requests', async () => {
      vi.stubEnv('VITE_API_URL', '');
      const fetchMock = stubFetch();
      await request('/api/v1/auth/session', z.object({}));
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/session');
    });

    it('uses a relative path for the live run stream (SSE)', () => {
      vi.stubEnv('VITE_API_URL', '');
      expect(runEventsUrl(ORGANIZATION_ID, RUN_ID)).toBe(
        `/api/v1/organizations/${ORGANIZATION_ID}/runs/${RUN_ID}/events`,
      );
    });

    it('treats an undefined variable as empty', () => {
      vi.stubEnv('VITE_API_URL', undefined);
      expect(apiUrl('/api/v1/x')).toBe('/api/v1/x');
    });
  });

  describe('with VITE_API_URL set (development: API on another port)', () => {
    it('prepends it to requests', async () => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
      const fetchMock = stubFetch();
      await request('/api/v1/auth/session', z.object({}));
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3000/api/v1/auth/session');
    });

    it('prepends it to the live run stream', () => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
      expect(runEventsUrl(ORGANIZATION_ID, RUN_ID)).toBe(
        `http://localhost:3000/api/v1/organizations/${ORGANIZATION_ID}/runs/${RUN_ID}/events`,
      );
    });

    it('does not double the slash when the value ends with one', () => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000/');
      expect(apiUrl('/api/v1/x')).toBe('http://localhost:3000/api/v1/x');
    });
  });
});
