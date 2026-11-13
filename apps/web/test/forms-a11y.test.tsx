/**
 * Forms of access, account and organization (F10, FR-025): a visible label, a 44 px field, an error
 * with an icon, text and `aria-describedby`, and a danger button plus a dialog for destructive actions.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE } from '@cognitive-dag/contracts';
import './flow-polyfills';
import { CORRELATION_ID, ORG_ID, json, openApp, sessionFor, signedIn } from './route-harness';

const guest = (url: string) => {
  if (/\/features$/.test(url)) return Promise.resolve(json({}));
  return Promise.resolve(
    new Response(
      JSON.stringify({
        status: 401,
        title: 'Unauthorized',
        detail: 'Inicia sesión.',
        code: 'UNAUTHENTICATED',
        correlationId: CORRELATION_ID,
      }),
      { status: 401, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
    ),
  );
};

/** Checks one invalid field the way FR-025 asks. */
function expectAccessibleError(field: HTMLElement) {
  // A visible label tied to the field.
  expect(document.querySelector(`label[for="${CSS.escape(field.id)}"]`), field.id).not.toBeNull();
  // 44 px tall.
  expect(field.className).toMatch(/\bh-11\b/);
  // The error: an icon and text, and the field points at it.
  const message = (field.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((element) => element?.querySelector('svg') != null);
  expect(message, `error message of #${field.id}`).toBeDefined();
  expect((message?.textContent ?? '').trim().length).toBeGreaterThan(0);
}

/** Submits the empty form and checks every invalid field. */
async function submitEmpty(submit: string | RegExp) {
  const user = userEvent.setup();
  const main = await screen.findByRole('main');
  await user.click(await within(main).findByRole('button', { name: submit }));
  await waitFor(() =>
    expect(main.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0),
  );
  for (const field of main.querySelectorAll<HTMLElement>('[aria-invalid="true"]')) {
    expectAccessibleError(field);
  }
}

describe('forms of access, account and organization', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ['/login', 'Iniciar sesión', 'Iniciar sesión'],
    ['/forgot-password', /Enviar/, 'Recuperar contraseña'],
  ] as const)('%s has an h1 and accessible field errors', async (path, submit, title) => {
    openApp(path, guest);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeDefined();
    await submitEmpty(submit);
  });

  it('/register keeps its form and accessible field errors', async () => {
    openApp('/register', guest);
    expect(await screen.findByRole('heading', { level: 1 })).toBeDefined();
    await submitEmpty(/Crear cuenta|Registrar/);
  });

  it('/reset-password with a token has an h1 and accessible field errors', async () => {
    openApp('/reset-password?token=t', guest);
    expect(await screen.findByRole('heading', { level: 1 })).toBeDefined();
    await submitEmpty(/contraseña|Guardar|Cambiar/i);
  });

  it('/account/password has an h1 and accessible field errors', async () => {
    openApp('/account/password', signedIn());
    expect(await screen.findByRole('heading', { level: 1 })).toBeDefined();
    await submitEmpty(/Cambiar contraseña|Guardar/);
  });

  it('the organization name form has accessible field errors', async () => {
    const user = userEvent.setup();
    openApp(`/orgs/${ORG_ID}`, signedIn('owner'));
    const field = await screen.findByLabelText('Nombre de la organización');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }));
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
    expectAccessibleError(field);
  });

  it('removing a member is a danger action confirmed in a dialog', async () => {
    const user = userEvent.setup();
    const api = signedIn('owner');
    openApp(`/orgs/${ORG_ID}/members`, (url) =>
      /\/members$/.test(url)
        ? Promise.resolve(
            json([
              {
                userId: sessionFor().user.id,
                name: 'Ana',
                email: 'ana@example.com',
                role: 'owner',
              },
              {
                userId: '0192f0a0-0000-7000-8000-000000000002',
                name: 'Luis',
                email: 'luis@example.com',
                role: 'editor',
              },
            ]),
          )
        : api(url),
    );
    const remove = await screen.findByRole('button', { name: 'Quitar a Luis' });
    expect(remove.getAttribute('data-variant')).toBe('danger');
    await user.click(remove);
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Quitar miembro' }).getAttribute('data-variant'),
    ).toBe('danger');
  });
});
