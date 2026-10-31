import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LimitsService } from '../workflows/limits.service';
import { ExecutionEnabledGuard } from './execution-enabled.guard';
import { RunEventsService } from './run-events.service';
import { RunTemporalService } from './run-history.service';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [RunsController],
  providers: [
    ExecutionEnabledGuard,
    IdentityEnabledGuard,
    LimitsService,
    RunEventsService,
    RunTemporalService,
    RunsService,
  ],
})
export class RunsModule {}
