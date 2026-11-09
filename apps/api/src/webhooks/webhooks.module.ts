import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RunsModule } from '../runs/runs.module';
import { WebhookTokenService } from './webhook-token.service';
import { HooksController, WebhookTokenController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [OrganizationsModule, RunsModule],
  controllers: [HooksController, WebhookTokenController],
  providers: [WebhookTokenService, WebhooksService],
})
export class WebhooksModule {}
