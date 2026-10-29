import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PROBLEM_CONTENT_TYPE } from '@cognitive-dag/contracts';
import { request, setApiEventHandlers, setCsrfToken } from '../src/api/client';

const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';
const ORGANIZATION_ID = '0192f0a0-0000-7000-8000-0000000000aa';

function problem(status: number, code: string): Response {
  return new Response(
    JSON.stringify({
      status,
      title: 'Error',
      detail: 'Detalle.',
      code,
      correlationId: CORRELATION_ID,
    }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );
}

function stubFetch(response: () => Response) {
  const mock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response()));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('api client session handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfToken(null);
    setApiEventHandlers({});
  });

  it('sends the session cookie with every request', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    await request('/api/v1/auth/session', z.object({}));
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('include');
  });

  it('adds X-CSRF-Token to state-changing requests only', async () => {
    setCsrfToken('t'.repeat(43));
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));

    await request('/api/v1/organizations', z.object({}), { method: 'POST', body: '{}' });
    await request('/api/v1/auth/session', z.object({}));

    const post = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const get = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(post.get('X-CSRF-Token')).toBe('t'.repeat(43));
    expect(get.has('X-CSRF-Token')).toBe(false);
  });

  it('sends no CSRF header before a session exists', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    await request('/api/v1/auth/login', z.object({}), { method: 'POST', body: '{}' });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('X-CSRF-Token')).toBe(false);
  });

  it('reports an expired session so the app can go to /login', async () => {
    const onUnauthenticated = vi.fn();
    setApiEventHandlers({ onUnauthenticated });
    stubFetch(() => problem(401, 'UNAUTHENTICATED'));

    await expect(
      request(`/api/v1/organizations/${ORGANIZATION_ID}/pings/ping-x`, z.object({})),
    ).rejects.toMatchObject({ problem: { code: 'UNAUTHENTICATED' } });
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('does not treat "nobody signed in" on the session check as an expiry', async () => {
    const onUnauthenticated = vi.fn();
    setApiEventHandlers({ onUnauthenticated });
    stubFetch(() => problem(401, 'UNAUTHENTICATED'));

    await expect(request('/api/v1/auth/session', z.object({}))).rejects.toBeDefined();
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('does not treat wrong credentials as an expired session', async () => {
    const onUnauthenticated = vi.fn();
    setApiEventHandlers({ onUnauthenticated });
    stubFetch(() => problem(401, 'INVALID_CREDENTIALS'));

    await expect(
      request('/api/v1/auth/login', z.object({}), { method: 'POST', body: '{}' }),
    ).rejects.toBeDefined();
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('reports a lost organization on a 404 under /organizations/{id}', async () => {
    const onOrganizationLost = vi.fn();
    setApiEventHandlers({ onOrganizationLost });
    stubFetch(() => problem(404, 'NOT_FOUND'));

    await expect(
      request(`/api/v1/organizations/${ORGANIZATION_ID}/pings/ping-x`, z.object({})),
    ).rejects.toBeDefined();
    expect(onOrganizationLost).toHaveBeenCalledWith(ORGANIZATION_ID);
  });
});
