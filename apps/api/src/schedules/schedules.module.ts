import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RunsModule } from '../runs/runs.module';
import { TriggersEnabledGuard } from '../triggers/triggers-enabled.guard';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [OrganizationsModule, RunsModule],
  controllers: [SchedulesController],
  providers: [IdentityEnabledGuard, SchedulesService, TriggersEnabledGuard],
  exports: [SchedulesService],
})
export class SchedulesModule {}
