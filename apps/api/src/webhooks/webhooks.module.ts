import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RunsModule } from '../runs/runs.module';
import { TriggersEnabledGuard } from '../triggers/triggers-enabled.guard';
import { WebhookTokenService } from './webhook-token.service';
import { HooksController, WebhookTokenController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [OrganizationsModule, RunsModule],
  controllers: [HooksController, WebhookTokenController],
  providers: [IdentityEnabledGuard, TriggersEnabledGuard, WebhookTokenService, WebhooksService],
})
export class WebhooksModule {}
