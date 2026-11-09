import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RunLauncher } from './run-launcher';
import { RunEventsService } from './run-events.service';
import { RunTemporalService } from './run-history.service';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [RunsController],
  exports: [RunLauncher, RunTemporalService],
  providers: [RunEventsService, RunLauncher, RunTemporalService, RunsService],
})
export class RunsModule {}
