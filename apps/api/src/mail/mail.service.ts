import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { MAILER, type MailMessage, type Mailer } from './mailer';

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

/**
 * Sends mail after the database transaction has committed. The caller never waits for SMTP and
 * never learns about a failure (anti-enumeration); failures are retried with backoff and logged.
 */
@Injectable()
export class MailService implements OnApplicationShutdown {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(MAILER) private readonly mailer: Mailer,
    @InjectPinoLogger(MailService.name) private readonly logger: PinoLogger,
  ) {}

  /** Call only after the transaction that justifies the email has committed. */
  dispatch(message: MailMessage): void {
    const task: Promise<void> = this.sendWithRetry(message).finally(() =>
      this.pending.delete(task),
    );
    this.pending.add(task);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  private async sendWithRetry(message: MailMessage): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.mailer.send(message);
        return;
      } catch (error) {
        const last = attempt === MAX_ATTEMPTS;
        // Neither recipient nor subject is logged: only that a delivery failed, and for which request.
        this.logger.warn(
          { err: error, attempt, correlationId: message.correlationId },
          last ? 'Email delivery failed permanently' : 'Email delivery failed, retrying',
        );
        if (last) return;
        await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** (attempt - 1)));
      }
    }
  }
}
