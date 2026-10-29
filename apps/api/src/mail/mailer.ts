export const MAILER = Symbol('MAILER');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  correlationId: string;
}

/** Replaceable mail transport (FR-030). The SMTP implementation talks to Mailpit in development. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
