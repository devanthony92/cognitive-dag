import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { MailService } from './mail.service';
import { MAILER } from './mailer';
import { SmtpMailer } from './smtp.mailer';

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new SmtpMailer({ host: config.SMTP_HOST, port: config.SMTP_PORT, from: config.MAIL_FROM }),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
