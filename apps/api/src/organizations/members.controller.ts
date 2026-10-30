import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Member } from '@cognitive-dag/contracts';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { MembersService } from './members.service';
import { OrganizationGuard } from './organization.guard';
import { ChangeMemberRoleDto, MembershipParamsDto } from './organizations.dto';
import { RequiredRoles } from './required-roles.decorator';
import type { RequestTenant } from './tenant-context';

/**
 * Everyone in the organization sees the list; only owners change who belongs to it (FR-022).
 * The guard re-reads the caller's role on every request, so a demotion applies at once (FR-025).
 */
@Controller('api/v1/organizations/:organizationId/members')
@UseGuards(IdentityEnabledGuard, OrganizationGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
  ): Promise<Member[]> {
    return this.members.list(auth.userId, tenant.organizationId);
  }

  @Patch(':membershipId')
  @RequiredRoles('owner')
  changeRole(
    @Param() params: MembershipParamsDto,
    @Body() body: ChangeMemberRoleDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<Member> {
    return this.members.changeRole(
      { userId: auth.userId, organizationId: tenant.organizationId, ip: req.ip ?? 'unknown' },
      params.membershipId,
      body.role,
    );
  }

  @Delete(':membershipId')
  @HttpCode(204)
  @RequiredRoles('owner')
  async remove(
    @Param() params: MembershipParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<void> {
    await this.members.remove(
      { userId: auth.userId, organizationId: tenant.organizationId, ip: req.ip ?? 'unknown' },
      params.membershipId,
    );
  }
}
