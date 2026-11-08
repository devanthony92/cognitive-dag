import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { Schedule } from '@cognitive-dag/contracts';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import type { RequestTenant } from '../organizations/tenant-context';
import { TriggersEnabledGuard } from '../triggers/triggers-enabled.guard';
import { WorkflowTriggerParamsDto } from '../triggers/triggers.dto';
import { SchedulesService } from './schedules.service';

/** Read only: activating, changing and deactivating a version writes the schedule (F2 endpoints). */
@Controller('api/v1/organizations/:organizationId/workflows/:workflowId/schedule')
@UseGuards(IdentityEnabledGuard, TriggersEnabledGuard, OrganizationGuard)
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  get(
    @Param() params: WorkflowTriggerParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<Schedule> {
    return this.schedules.get(
      { userId: auth.userId, organizationId: tenant.organizationId, ip: req.ip ?? 'unknown' },
      params.workflowId,
    );
  }
}
