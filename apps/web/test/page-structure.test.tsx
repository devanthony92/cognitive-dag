/**
 * Page structure of every list, settings and access screen (F10, FR-010, FR-023, SC-008): one `h1`,
 * one `main`, the named width of the screen, headings that never skip a level and, while the data
 * loads, a skeleton announced with `role="status"`. The editor and the run view are covered by PR 4.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE } from '@cognitive-dag/contracts';
import './flow-polyfills';
import { CORRELATION_ID, ORG_ID, json, openApp, sessionFor } from './route-harness';

const WORKFLOW_ID = '0192f0a0-0000-7000-8000-0000000000f1';

interface Screen {
  path: string;
  width: 'narrow' | 'default';
  signedIn: boolean;
  /** Whether the screen loads data of its own, so it has a loading state to check. */
  loads: boolean;
}

export const SCREENS: Screen[] = [
  { path: '/', width: 'narrow', signedIn: false, loads: false },
  { path: '/login', width: 'narrow', signedIn: false, loads: false },
  { path: '/register', width: 'narrow', signedIn: false, loads: false },
  { path: '/forgot-password', width: 'narrow', signedIn: false, loads: false },
  { path: '/reset-password', width: 'narrow', signedIn: false, loads: false },
  { path: '/verify-email', width: 'narrow', signedIn: false, loads: false },
  { path: '/invitations/accept', width: 'narrow', signedIn: true, loads: false },
  { path: '/account/password', width: 'narrow', signedIn: true, loads: false },
  { path: `/orgs/${ORG_ID}`, width: 'default', signedIn: true, loads: true },
  { path: `/orgs/${ORG_ID}/workflows`, width: 'default', signedIn: true, loads: true },
  { path: `/orgs/${ORG_ID}/workflows/new`, width: 'default', signedIn: true, loads: false },
  { path: `/orgs/${ORG_ID}/runs`, width: 'default', signedIn: true, loads: true },
  {
    path: `/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}/runs`,
    width: 'default',
    signedIn: true,
    loads: true,
  },
  { path: `/orgs/${ORG_ID}/approvals`, width: 'default', signedIn: true, loads: true },
  { path: `/orgs/${ORG_ID}/connections`, width: 'default', signedIn: true, loads: true },
  { path: `/orgs/${ORG_ID}/members`, width: 'default', signedIn: true, loads: true },
];

const unauthenticated = () =>
  new Response(
    JSON.stringify({
      status: 401,
      title: 'Unauthorized',
      detail: 'Inicia sesión.',
      code: 'UNAUTHENTICATED',
      correlationId: CORRELATION_ID,
    }),
    { status: 401, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );

/** Session and flags answer at once; `data` decides what everything else does. */
function api(signedIn: boolean, data: (url: string) => Promise<Response>) {
  return (url: string) => {
    if (/\/features$/.test(url)) return Promise.resolve(json({}));
    if (/\/auth\/session$/.test(url))
      return Promise.resolve(signedIn ? json(sessionFor('owner')) : unauthenticated());
    return data(url);
  };
}

const empty = () => Promise.resolve(json([]));
const never = () => new Promise<Response>(() => undefined);

async function mainOf() {
  return screen.findByRole('main');
}

describe('page structure of the list, settings and access screens', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe.each(SCREENS)('$path', ({ path, width, signedIn, loads }) => {
    it('has one h1, one main, its named width and no skipped heading level', async () => {
      openApp(path, api(signedIn, empty));
      const container = document.body;
      const main = await mainOf();
      await waitFor(() =>
        expect(within(main).getAllByRole('heading', { level: 1 })).toHaveLength(1),
      );

      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(container.querySelector('[data-width]')?.getAttribute('data-width')).toBe(width);

      let previous = 0;
      for (const heading of main.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
        const level = Number(heading.tagName.slice(1));
        expect(level, heading.textContent ?? '').toBeLessThanOrEqual(previous + 1);
        previous = level;
      }
      expect(main.querySelector('h1')).not.toBeNull();
    });

    it.runIf(loads)('shows its title and a status skeleton while the data loads', async () => {
      openApp(path, api(signedIn, never));
      const main = await mainOf();
      await waitFor(() => expect(within(main).getAllByRole('status').length).toBeGreaterThan(0));
      expect(within(main).getAllByRole('heading', { level: 1 })).toHaveLength(1);
      // No loose «Cargando…» line: the only text of a loading state is the one for assistive technology.
      const loose = [...main.querySelectorAll('*')].filter(
        (element) =>
          element.children.length === 0 &&
          !element.classList.contains('sr-only') &&
          /^Cargando.*…$/.test(element.textContent?.trim() ?? ''),
      );
      expect(loose.map((element) => element.textContent)).toEqual([]);
    });
  });
});
