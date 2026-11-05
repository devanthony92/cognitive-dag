import { Controller, Get, UseGuards } from '@nestjs/common';
import type { LlmDailyUsage } from '@cognitive-dag/contracts';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import type { RequestTenant } from '../organizations/tenant-context';
import { LlmNodesEnabledGuard } from './llm-nodes-enabled.guard';
import { LlmUsageService } from './llm-usage.service';

/** `GET /organizations/{organizationId}/llm-usage/today` (F5). Any member may read it. */
@Controller('api/v1/organizations/:organizationId/llm-usage')
@UseGuards(IdentityEnabledGuard, LlmNodesEnabledGuard, OrganizationGuard)
export class LlmUsageController {
  constructor(private readonly usage: LlmUsageService) {}

  @Get('today')
  today(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
  ): Promise<LlmDailyUsage> {
    return this.usage.today(auth.userId, tenant.organizationId);
  }
}
