import { Body, Controller, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { OrganizationSummary } from '@cognitive-dag/contracts';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { OrganizationGuard } from './organization.guard';
import { CreateOrganizationDto, RenameOrganizationDto } from './organizations.dto';
import { RequiredRoles } from './required-roles.decorator';
import type { RequestTenant } from './tenant-context';
import { OrganizationsService } from './organizations.service';

@Controller('api/v1/organizations')
@UseGuards(IdentityEnabledGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  @HttpCode(201)
  create(
    @Body() body: CreateOrganizationDto,
    @CurrentAuth() auth: AuthSession,
    @Req() req: Request,
  ): Promise<OrganizationSummary> {
    return this.organizations.create(auth.userId, body.name, req.ip ?? 'unknown');
  }

  /** Only an owner renames; the guard answers 404 to non-members and 403 to editors and viewers. */
  @Patch(':organizationId')
  @UseGuards(OrganizationGuard)
  @RequiredRoles('owner')
  rename(
    @Param('organizationId') _organizationId: string,
    @Body() body: RenameOrganizationDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<OrganizationSummary> {
    return this.organizations.rename(
      { userId: auth.userId, organizationId: tenant.organizationId, ip: req.ip ?? 'unknown' },
      body.name,
    );
  }
}
