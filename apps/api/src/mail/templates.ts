import type { MailMessage } from './mailer';

type Content = Omit<MailMessage, 'to' | 'correlationId'>;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function layout(
  paragraphs: string[],
  action?: { label: string; url: string },
): Pick<Content, 'html' | 'text'> {
  const text = [
    ...paragraphs,
    ...(action ? [`${action.label}: ${action.url}`] : []),
    'CognitiveDAG',
  ].join('\n\n');
  const html = [
    '<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;max-width:560px">',
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ...(action
      ? [`<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`]
      : []),
    '<p>CognitiveDAG</p></body></html>',
  ].join('');
  return { text, html };
}

/** The link carries the token in the query string of the web app, never of the API. */
export function verificationLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/verify-email?token=${token}`;
}

export function verificationEmail(name: string, url: string): Content {
  return {
    subject: 'Verifica tu correo en CognitiveDAG',
    ...layout(
      [
        `Hola ${name},`,
        'Para activar tu cuenta, confirma tu correo con el siguiente enlace. Vence en 24 horas y solo sirve una vez.',
        'Si no creaste esta cuenta, ignora este mensaje.',
      ],
      { label: 'Verificar mi correo', url },
    ),
  };
}

/** Sent to the owner of an existing account when someone registers with its email (FR-014). */
export function registrationAttemptEmail(name: string): Content {
  return {
    subject: 'Intento de registro con tu correo en CognitiveDAG',
    ...layout([
      `Hola ${name},`,
      'Alguien intentó registrarse en CognitiveDAG con este correo, que ya tiene una cuenta.',
      'Si fuiste tú, inicia sesión o restablece tu contraseña. Si no, puedes ignorar este mensaje: tu cuenta no cambió.',
    ]),
  };
}
