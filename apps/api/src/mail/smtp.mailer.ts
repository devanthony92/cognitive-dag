import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { CORRELATION_ID_HEADER } from '@cognitive-dag/contracts';
import type { MailMessage, Mailer } from './mailer';

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

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transport = createTransport(buildTransportOptions(options));
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { [CORRELATION_ID_HEADER]: message.correlationId },
    });
  }

  close(): void {
    this.transport.close();
  }
}
