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

export function passwordResetLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
}

export function passwordResetEmail(name: string, url: string): Content {
  return {
    subject: 'Restablece tu contraseña en CognitiveDAG',
    ...layout(
      [
        `Hola ${name},`,
        'Recibimos una solicitud para restablecer tu contraseña. El enlace vence en 30 minutos y solo sirve una vez. Al usarlo se cerrarán todas tus sesiones.',
        'Si no fuiste tú, ignora este mensaje: tu contraseña no cambió.',
      ],
      { label: 'Restablecer mi contraseña', url },
    ),
  };
}

export function invitationLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/invitations/accept?token=${token}`;
}

const ROLE_NAMES = { owner: 'owner', editor: 'editor', viewer: 'viewer' } as const;

export function invitationEmail(input: {
  organizationName: string;
  inviterName: string;
  role: keyof typeof ROLE_NAMES;
  url: string;
}): Content {
  return {
    subject: `${input.inviterName} te invitó a ${input.organizationName} en CognitiveDAG`,
    ...layout(
      [
        'Hola,',
        `${input.inviterName} te invitó a la organización "${input.organizationName}" con el rol ${ROLE_NAMES[input.role]}. La invitación vence en 7 días y solo sirve una vez.`,
        'Si todavía no tienes cuenta, podrás crearla desde el enlace con este mismo correo. Si no esperabas esta invitación, ignora este mensaje.',
      ],
      { label: 'Ver la invitación', url: input.url },
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
