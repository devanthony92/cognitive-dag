import { Controller, Get, UseGuards } from '@nestjs/common';
import type { LimitsBody } from '@cognitive-dag/contracts';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import type { RequestTenant } from '../organizations/tenant-context';
import { DagEditorEnabledGuard } from './dag-editor-enabled.guard';
import { LimitsService } from './limits.service';

/**
 * Read-only on purpose (FR-021): there is no endpoint that writes limits. The operator changes
 * them with `pnpm ops:set-limits`, connected as `app_migrator`.
 */
@Controller('api/v1/organizations/:organizationId/limits')
@UseGuards(IdentityEnabledGuard, DagEditorEnabledGuard, OrganizationGuard)
export class LimitsController {
  constructor(private readonly limits: LimitsService) {}

  @Get()
  get(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
  ): Promise<LimitsBody> {
    return this.limits.effective(auth.userId, tenant.organizationId);
  }
}
