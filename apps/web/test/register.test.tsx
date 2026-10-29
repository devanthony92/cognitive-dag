import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE } from '@cognitive-dag/contracts';
import { RegisterForm } from '../src/features/auth/RegisterForm';
import { VerifyEmailPanel } from '../src/features/auth/VerifyEmailPanel';

const ACCEPTED = { message: 'Si los datos son correctos, recibirás un correo en breve.' };
const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';

function json(status: number, body: unknown, problem = false): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': problem ? PROBLEM_CONTENT_TYPE : 'application/json' },
  });
}

function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return json(
    status,
    {
      status,
      title: 'Error',
      detail: 'Detalle del problema.',
      code,
      correlationId: CORRELATION_ID,
      ...extra,
    },
    true,
  );
}

function renderWithClient(ui: React.ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const mock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('RegisterForm', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('validates with the shared schema before calling the API', async () => {
    const fetchMock = mockFetch(() => json(202, ACCEPTED));
    const user = userEvent.setup();
    renderWithClient(<RegisterForm />);

    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByText('Debe tener entre 1 y 100 caracteres.')).toBeDefined();
    expect(screen.getByText('Debe ser un email válido.')).toBeDefined();
    expect(screen.getByText('Debe tener al menos 15 caracteres.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the generic message after a valid submit and sends the normalized body', async () => {
    const fetchMock = mockFetch(() => json(202, ACCEPTED));
    const user = userEvent.setup();
    renderWithClient(<RegisterForm />);

    await user.type(screen.getByLabelText('Nombre'), 'Ana');
    await user.type(screen.getByLabelText('Correo electrónico'), '  Ana@Example.COM ');
    await user.type(screen.getByLabelText('Contraseña'), 'un-caballo-azul-en-marte');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByText(/Revisa tu correo/)).toBeDefined();
    expect(screen.getByText(ACCEPTED.message)).toBeDefined();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/v1\/auth\/register$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      password: 'un-caballo-azul-en-marte',
    });
    // The form is replaced by the confirmation: nothing reveals whether the email already existed.
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
  });

  it('shows the server rule that rejected the password under its field', async () => {
    mockFetch(() =>
      problem(422, 'VALIDATION_FAILED', {
        errors: [{ field: 'password', message: 'Es una contraseña demasiado común. Elige otra.' }],
      }),
    );
    const user = userEvent.setup();
    renderWithClient(<RegisterForm />);

    await user.type(screen.getByLabelText('Nombre'), 'Ana');
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'password123456789');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByText('Es una contraseña demasiado común. Elige otra.')).toBeDefined();
  });

  it('shows the wait and the correlation id when the API rate limits', async () => {
    mockFetch(() => problem(429, 'RATE_LIMITED', { retryAfterSeconds: 120 }));
    const user = userEvent.setup();
    renderWithClient(<RegisterForm />);

    await user.type(screen.getByLabelText('Nombre'), 'Ana');
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'un-caballo-azul-en-marte');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('2 minutos');
    expect(alert.textContent).toContain(CORRELATION_ID);
  });
});

describe('VerifyEmailPanel', () => {
  const token = 'A'.repeat(43);

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sends the token in the body and confirms the verification', async () => {
    const fetchMock = mockFetch(() => json(204, null));
    renderWithClient(<VerifyEmailPanel token={token} />);

    expect(await screen.findByText('Tu correo quedó verificado.')).toBeDefined();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).not.toContain(token);
    expect(JSON.parse(init?.body as string)).toEqual({ token });
  });

  it('offers to resend the link when the token is invalid, and answers generically', async () => {
    const fetchMock = mockFetch((url) =>
      url.endsWith('/resend') ? json(202, ACCEPTED) : problem(422, 'TOKEN_INVALID'),
    );
    const user = userEvent.setup();
    renderWithClient(<VerifyEmailPanel token={token} />);

    expect(await screen.findByText(/no es válido|vencido/i)).toBeDefined();
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Reenviar enlace' }));

    await waitFor(() => expect(screen.getByText(ACCEPTED.message)).toBeDefined());
    const resend = fetchMock.mock.calls.find(([url]) => url.endsWith('/resend'));
    expect(JSON.parse(resend?.[1]?.body as string)).toEqual({ email: 'ana@example.com' });
  });

  it('asks for a new link when the page has no token', async () => {
    const fetchMock = mockFetch(() => json(204, null));
    renderWithClient(<VerifyEmailPanel token={undefined} />);

    expect(await screen.findByRole('button', { name: 'Reenviar enlace' })).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
