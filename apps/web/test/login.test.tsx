import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type SessionInfo } from '@cognitive-dag/contracts';
import { LoginForm } from '../src/features/auth/LoginForm';

const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';
const SESSION: SessionInfo = {
  user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'ana@example.com' },
  organizations: [
    {
      id: '0192f0a0-0000-7000-8000-0000000000aa',
      name: 'Organización de Ana',
      role: 'owner',
      isPersonal: true,
    },
  ],
  csrfToken: 'c'.repeat(43),
};

function problem(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      status,
      title: 'Error',
      detail: 'Las credenciales no son válidas.',
      code,
      correlationId: CORRELATION_ID,
      ...extra,
    }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );
}

function renderForm(onLoggedIn = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LoginForm onLoggedIn={onLoggedIn} />
    </QueryClientProvider>,
  );
  return onLoggedIn;
}

describe('LoginForm', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('asks for both fields before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Ingresa tu correo electrónico.')).toBeDefined();
    expect(screen.getByText('Ingresa tu contraseña.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows and hides the password with an accessible button', async () => {
    renderForm();
    const user = userEvent.setup();
    const password = screen.getByLabelText<HTMLInputElement>('Contraseña');
    expect(password.type).toBe('password');

    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(password.type).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(password.type).toBe('password');
  });

  it('posts the credentials with the cookie and hands the session to the app', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(SESSION), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const onLoggedIn = renderForm();

    await user.type(screen.getByLabelText('Correo electrónico'), ' Ana@Example.com ');
    await user.type(screen.getByLabelText('Contraseña'), 'un-caballo-azul-en-marte');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(onLoggedIn.mock.calls[0]?.[0]).toEqual(SESSION);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/auth\/login$/);
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'Ana@Example.com',
      password: 'un-caballo-azul-en-marte',
    });
  });

  it('shows the generic message for invalid credentials and keeps the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(problem(401, 'INVALID_CREDENTIALS'))),
    );
    const user = userEvent.setup();
    const onLoggedIn = renderForm();

    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Las credenciales no son válidas.');
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  it('shows the wait when the API rate limits the login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(problem(429, 'RATE_LIMITED', { retryAfterSeconds: 30 }))),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('30 segundos');
  });
});
