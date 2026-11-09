import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ApprovalListQuerySchema,
  DecideApprovalRequestSchema,
  type Approval,
  type ApprovalCount,
  type ApprovalDetail,
  type ApprovalList,
} from '@cognitive-dag/contracts';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import { RequiredRoles } from '../organizations/required-roles.decorator';
import type { RequestTenant } from '../organizations/tenant-context';
import { OrganizationOnlyParamsDto } from '../triggers/triggers.dto';
import { ApprovalsService, type ApprovalActor } from './approvals.service';

class ApprovalListQueryDto extends createZodDto(ApprovalListQuerySchema) {}
class DecideApprovalDto extends createZodDto(DecideApprovalRequestSchema) {}
class ApprovalParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), approvalId: z.uuid() }),
) {}

const actorOf = (auth: AuthSession, tenant: RequestTenant, req: Request): ApprovalActor => ({
  userId: auth.userId,
  organizationId: tenant.organizationId,
  ip: req.ip ?? 'unknown',
});

/** Owners and editors only. The role is read again on every request, so a lost role applies at once. */
@Controller('api/v1/organizations/:organizationId/approvals')
@UseGuards(OrganizationGuard)
@RequiredRoles('owner', 'editor')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(
    @Param() _params: OrganizationOnlyParamsDto,
    @Query() query: ApprovalListQueryDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<ApprovalList> {
    return this.approvals.list(actorOf(auth, tenant, req), query);
  }

  // Declared before `:approvalId` so "count" is not read as an id.
  @Get('count')
  count(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<ApprovalCount> {
    return this.approvals.count(actorOf(auth, tenant, req));
  }

  @Get(':approvalId')
  get(
    @Param() params: ApprovalParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<ApprovalDetail> {
    return this.approvals.get(actorOf(auth, tenant, req), params.approvalId);
  }

  @Post(':approvalId/decision')
  @HttpCode(200)
  decide(
    @Param() params: ApprovalParamsDto,
    @Body() body: DecideApprovalDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<Approval> {
    return this.approvals.decide(
      actorOf(auth, tenant, req),
      params.approvalId,
      body.decision,
      body.comment,
    );
  }
}
