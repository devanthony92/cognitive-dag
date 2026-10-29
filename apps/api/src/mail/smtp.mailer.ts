import { createTransport, type Transporter } from 'nodemailer';
import { CORRELATION_ID_HEADER } from '@cognitive-dag/contracts';
import type { MailMessage, Mailer } from './mailer';

export interface SmtpOptions {
  host: string;
  port: number;
  from: string;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transport = createTransport({
      host: options.host,
      port: options.port,
      secure: false,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
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
