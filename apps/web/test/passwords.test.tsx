import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE } from '@cognitive-dag/contracts';
import { ChangePasswordForm } from '../src/features/account/ChangePasswordForm';
import { ForgotPasswordForm, ResetPasswordForm } from '../src/features/auth/PasswordResetForms';

const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';
const TOKEN = 'T'.repeat(43);
const NEW_PASSWORD = 'otra-contraseña-nueva';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const noContent = () => new Response(null, { status: 204 });
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      status,
      title: 'Error',
      detail: 'Detalle del error.',
      code,
      correlationId: CORRELATION_ID,
      ...extra,
    }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );

function renderWithClient(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

describe('password screens', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('ForgotPasswordForm', () => {
    it('shows the generic answer whatever the email', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          json(202, { message: 'Si los datos son correctos, recibirás un correo en breve.' }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderWithClient(<ForgotPasswordForm />);

      await user.type(screen.getByLabelText('Correo electrónico'), 'Nadie@Example.com');
      await user.click(screen.getByRole('button', { name: 'Enviar enlace' }));

      expect(await screen.findByText(/recibirás un correo en breve/)).toBeDefined();
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(/\/api\/v1\/auth\/password-reset\/request$/);
      expect(JSON.parse(init.body as string)).toEqual({ email: 'nadie@example.com' });
    });
  });

  describe('ResetPasswordForm', () => {
    it('sends the token in the body, never in the URL, and ends at the login link', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(noContent()));
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderWithClient(<ResetPasswordForm token={TOKEN} />);

      await user.type(screen.getByLabelText('Contraseña nueva'), NEW_PASSWORD);
      await user.type(screen.getByLabelText('Repite la contraseña nueva'), NEW_PASSWORD);
      await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

      expect(await screen.findByText('Contraseña actualizada')).toBeDefined();
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(/\/api\/v1\/auth\/password-reset\/confirm$/);
      expect(url).not.toContain(TOKEN);
      expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN, password: NEW_PASSWORD });
      expect(screen.getByRole('link', { name: 'Iniciar sesión' }).getAttribute('href')).toBe(
        '/login',
      );
    });

    it('checks the length before calling the API', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderWithClient(<ResetPasswordForm token={TOKEN} />);

      await user.type(screen.getByLabelText('Contraseña nueva'), 'corta');
      await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

      expect(await screen.findByText('Debe tener al menos 8 caracteres.')).toBeDefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('blocks a different confirmation without calling the API', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderWithClient(<ResetPasswordForm token={TOKEN} />);

      await user.type(screen.getByLabelText('Contraseña nueva'), NEW_PASSWORD);
      await user.type(screen.getByLabelText('Repite la contraseña nueva'), `${NEW_PASSWORD}x`);
      await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

      expect(await screen.findByText('Las contraseñas no coinciden.')).toBeDefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows and hides the new password and its confirmation', async () => {
      renderWithClient(<ResetPasswordForm token={TOKEN} />);
      const user = userEvent.setup();
      const password = screen.getByLabelText<HTMLInputElement>('Contraseña nueva');
      expect(password.type).toBe('password');
      await user.click(screen.getAllByRole('button', { name: 'Mostrar contraseña' })[0]!);
      expect(password.type).toBe('text');
      await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
      expect(password.type).toBe('password');
    });

    it('offers a new link when the server rejects the token', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(problem(422, 'TOKEN_INVALID'))),
      );
      const user = userEvent.setup();
      renderWithClient(<ResetPasswordForm token={TOKEN} />);

      await user.type(screen.getByLabelText('Contraseña nueva'), NEW_PASSWORD);
      await user.type(screen.getByLabelText('Repite la contraseña nueva'), NEW_PASSWORD);
      await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

      expect(await screen.findByRole('alert')).toBeDefined();
      expect(screen.getByRole('link', { name: 'Pedir un enlace nuevo' })).toBeDefined();
    });

    it('explains a missing token without calling the API', () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      renderWithClient(<ResetPasswordForm token={undefined} />);
      expect(screen.getByText('Enlace no válido')).toBeDefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('ChangePasswordForm', () => {
    it('posts both passwords and confirms', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(noContent()));
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderWithClient(<ChangePasswordForm />);

      await user.type(screen.getByLabelText('Contraseña actual'), 'la-contraseña-de-antes');
      await user.type(screen.getByLabelText('Contraseña nueva'), NEW_PASSWORD);
      await user.type(screen.getByLabelText('Repite la contraseña nueva'), NEW_PASSWORD);
      await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

      expect(await screen.findByText(/Contraseña actualizada/)).toBeDefined();
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        currentPassword: 'la-contraseña-de-antes',
        newPassword: NEW_PASSWORD,
      });
    });

    it('blocks a different confirmation without calling the API', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderWithClient(<ChangePasswordForm />);

      await user.type(screen.getByLabelText('Contraseña actual'), 'la-contraseña-de-antes');
      await user.type(screen.getByLabelText('Contraseña nueva'), NEW_PASSWORD);
      await user.type(screen.getByLabelText('Repite la contraseña nueva'), 'otra-cosa-distinta');
      await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

      expect(await screen.findByText('Las contraseñas no coinciden.')).toBeDefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows and hides each of the three password fields on its own', async () => {
      renderWithClient(<ChangePasswordForm />);
      const user = userEvent.setup();
      const current = screen.getByLabelText<HTMLInputElement>('Contraseña actual');
      const next = screen.getByLabelText<HTMLInputElement>('Contraseña nueva');
      const buttons = screen.getAllByRole('button', { name: 'Mostrar contraseña' });
      expect(buttons).toHaveLength(3);
      await user.click(buttons[0]!);
      expect(current.type).toBe('text');
      expect(next.type).toBe('password');
    });

    it('marks the current password field when it is wrong', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(problem(401, 'INVALID_CREDENTIALS'))),
      );
      const user = userEvent.setup();
      renderWithClient(<ChangePasswordForm />);

      await user.type(screen.getByLabelText('Contraseña actual'), 'equivocada');
      await user.type(screen.getByLabelText('Contraseña nueva'), NEW_PASSWORD);
      await user.type(screen.getByLabelText('Repite la contraseña nueva'), NEW_PASSWORD);
      await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

      await waitFor(() =>
        expect(screen.getByText('La contraseña actual no es correcta.')).toBeDefined(),
      );
    });
  });
});
