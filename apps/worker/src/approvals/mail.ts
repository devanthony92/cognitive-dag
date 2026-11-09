import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { CORRELATION_ID_HEADER } from '@cognitive-dag/contracts';

export interface ApprovalMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  correlationId: string;
}

export interface Mailer {
  send(message: ApprovalMail): Promise<void>;
  close(): void;
}

export interface SmtpOptions {
  host: string;
  port: number;
  from: string;
  /** `true` implicit TLS, `starttls` required upgrade, `false` plain text (Mailpit). */
  secure?: 'true' | 'false' | 'starttls' | undefined;
  auth?: { user: string; password: string } | undefined;
  /** Production refuses plain text and a missing login (FR-030). */
  production?: boolean | undefined;
}

/**
 * Transport options. Without `secure` and `auth` they are the ones of the development setup with
 * Mailpit. Errors name the variable and never a value.
 */
export function buildTransportOptions(options: SmtpOptions): SMTPTransport.Options {
  const secure = options.secure ?? 'false';
  if (options.production) {
    if (secure === 'false') throw new Error('SMTP_SECURE must enable TLS in production');
    if (options.auth === undefined) {
      throw new Error('SMTP_USER_FILE and SMTP_PASSWORD_FILE are required in production');
    }
  }
  return {
    host: options.host,
    port: options.port,
    secure: secure === 'true',
    ...(secure === 'starttls' ? { requireTLS: true } : {}),
    ...(options.auth ? { auth: { user: options.auth.user, pass: options.auth.password } } : {}),
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  };
}

/** The same SMTP variables and library as the API (ADR-0034); the templates live apart (R8). */
export function createSmtpMailer(options: SmtpOptions): Mailer {
  const transport: Transporter = createTransport(buildTransportOptions(options));
  return {
    async send(message) {
      await transport.sendMail({
        from: options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { [CORRELATION_ID_HEADER]: message.correlationId },
      });
    },
    close() {
      transport.close();
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export interface ApprovalEmailInput {
  workflowName: string;
  nodeLabel: string;
  expiresAt: Date;
  /** Link to the request in the web app; the email never decides anything (R7). */
  url: string;
}

/**
 * Notice of a pending approval. It carries the workflow, the node label, the deadline and a link,
 * and never the message of the approval: that may hold data of the run and lives only in Temporal
 * (research R8).
 */
export function approvalRequestedEmail(
  input: ApprovalEmailInput,
): Pick<ApprovalMail, 'subject' | 'text' | 'html'> {
  const deadline = input.expiresAt
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
  const paragraphs = [
    `El workflow «${input.workflowName}» espera una aprobación en el paso «${input.nodeLabel}».`,
    `Plazo para decidir: ${deadline}.`,
    'Abre la solicitud para revisarla y aprobarla o rechazarla. Este correo no permite decidir.',
  ];
  const text = [...paragraphs, `Abrir la solicitud: ${input.url}`, 'CognitiveDAG'].join('\n\n');
  const html = [
    '<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;max-width:560px">',
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    `<p><a href="${escapeHtml(input.url)}">Abrir la solicitud</a></p>`,
    '<p>CognitiveDAG</p></body></html>',
  ].join('');
  return { subject: `Aprobación pendiente en ${input.workflowName}`, text, html };
}
