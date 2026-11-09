import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { LimitsController } from './limits.controller';
import { LimitsService } from './limits.service';
import { VersionsService } from './versions.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [OrganizationsModule, SchedulesModule],
  controllers: [WorkflowsController, LimitsController],
  providers: [LimitsService, VersionsService, WorkflowsService],
})
export class WorkflowsModule {}
