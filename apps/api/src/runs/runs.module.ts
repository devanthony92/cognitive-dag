import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ExecutionEnabledGuard } from './execution-enabled.guard';
import { ResilienceEnabledGuard } from './resilience-enabled.guard';
import { RunLauncher } from './run-launcher';
import { RunEventsService } from './run-events.service';
import { RunTemporalService } from './run-history.service';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [RunsController],
  exports: [RunLauncher, RunTemporalService],
  providers: [
    ExecutionEnabledGuard,
    IdentityEnabledGuard,
    ResilienceEnabledGuard,
    RunEventsService,
    RunLauncher,
    RunTemporalService,
    RunsService,
  ],
})
export class RunsModule {}
