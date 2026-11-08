import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RunsModule } from '../runs/runs.module';
import { TriggersEnabledGuard } from '../triggers/triggers-enabled.guard';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [OrganizationsModule, RunsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, IdentityEnabledGuard, TriggersEnabledGuard],
})
export class ApprovalsModule {}
