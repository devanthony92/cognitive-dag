import { Module } from '@nestjs/common';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DagEditorEnabledGuard } from './dag-editor-enabled.guard';
import { LimitsController } from './limits.controller';
import { LimitsService } from './limits.service';
import { VersionsService } from './versions.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [WorkflowsController, LimitsController],
  providers: [
    DagEditorEnabledGuard,
    IdentityEnabledGuard,
    LimitsService,
    VersionsService,
    WorkflowsService,
  ],
})
export class WorkflowsModule {}
