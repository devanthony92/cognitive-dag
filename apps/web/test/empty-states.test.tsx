/**
 * Empty lists keep their Spanish text and gain one action (F10, FR-019, contract §6). The text and the
 * action sit in an `EmptyState` inside `page-default`, so a first visit is never a dead end.
 */
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './flow-polyfills';
import { ORG_ID, json, openApp, signedIn } from './route-harness';

const WORKFLOW_ID = '0192f0a0-0000-7000-8000-0000000000f1';

/** Everything is an empty list except what the screen needs to be a screen. */
function empties(url: string) {
  if (/\/workflows\/[0-9a-f-]{36}$/.test(url)) {
    return Promise.resolve(
      json({
        id: WORKFLOW_ID,
        name: 'Soporte',
        draftRevision: 1,
        draftUpdatedAt: '2026-10-30T12:00:00.000Z',
        activeVersionNumber: 1,
        draft: { schemaVersion: 1, nodes: [], edges: [] },
      }),
    );
  }
  if (/\/(runs|approvals|http-allowed-hosts|credentials)(\?.*)?$/.test(url)) {
    return Promise.resolve(json({ items: [], nextCursor: null }));
  }
  return signedIn()(url);
}

const CASES: { name: string; path: string; text: RegExp }[] = [
  { name: 'Workflows', path: `/orgs/${ORG_ID}/workflows`, text: /Todavía no hay workflows\./ },
  {
    name: 'Ejecuciones',
    path: `/orgs/${ORG_ID}/runs`,
    text: /La organización todavía no tiene ejecuciones\./,
  },
  {
    name: 'Ejecuciones de un workflow',
    path: `/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}/runs`,
    text: /Este workflow todavía no se ha ejecutado\./,
  },
  {
    name: 'Aprobaciones',
    path: `/orgs/${ORG_ID}/approvals`,
    text: /No tienes solicitudes pendientes\./,
  },
  {
    name: 'Conexiones',
    path: `/orgs/${ORG_ID}/connections`,
    text: /Todavía no hay credenciales\./,
  },
  { name: 'Miembros', path: `/orgs/${ORG_ID}/members`, text: /No hay invitaciones pendientes\./ },
];

describe('empty states', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(CASES)('$name keeps its text and offers an action inside page-default', async (item) => {
    openApp(item.path, empties);
    const container = document.body;
    const message = await screen.findByText(item.text);

    const empty = message.closest('section');
    expect(empty, 'the text lives in an EmptyState section').not.toBeNull();
    expect(
      within(empty as HTMLElement).queryAllByRole('button').length +
        within(empty as HTMLElement).queryAllByRole('link').length,
    ).toBeGreaterThan(0);
    expect(empty?.closest('[data-width]')?.getAttribute('data-width')).toBe('default');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('Aprobaciones offers the history when nothing is pending, and the way back', async () => {
    const user = userEvent.setup();
    openApp(`/orgs/${ORG_ID}/approvals`, empties);
    const pending = await screen.findByText(/No tienes solicitudes pendientes\./);
    await user.click(
      within(pending.closest('section') as HTMLElement).getByRole('button', {
        name: 'Ver historial',
      }),
    );
    const resolved = await screen.findByText(/Todavía no hay solicitudes resueltas\./);
    expect(
      within(resolved.closest('section') as HTMLElement).getByRole('button', {
        name: 'Ver pendientes',
      }),
    ).toBeDefined();
  });
});
