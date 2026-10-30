import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Invitation, InvitationPreview, OrganizationSummary } from '@cognitive-dag/contracts';
import { TokenDto } from '../auth/auth.dto';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { Public } from '../auth/public.decorator';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { InvitationsService } from './invitations.service';
import { OrganizationGuard } from './organization.guard';
import { CreateInvitationDto, InvitationParamsDto } from './organizations.dto';
import { RequiredRoles } from './required-roles.decorator';
import type { RequestTenant } from './tenant-context';

/** Managing invitations is for owners only (FR-022). */
@Controller('api/v1/organizations/:organizationId/invitations')
@UseGuards(IdentityEnabledGuard, OrganizationGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequiredRoles('owner')
  list(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
  ): Promise<Invitation[]> {
    return this.invitations.list(auth.userId, tenant.organizationId);
  }

  @Post()
  @HttpCode(201)
  @RequiredRoles('owner')
  create(
    @Body() body: CreateInvitationDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<Invitation> {
    return this.invitations.create(
      { userId: auth.userId, organizationId: tenant.organizationId, ip: req.ip ?? 'unknown' },
      body.email,
      body.role,
    );
  }

  @Delete(':invitationId')
  @HttpCode(204)
  @RequiredRoles('owner')
  async revoke(
    @Param() params: InvitationParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<void> {
    await this.invitations.revoke(
      { userId: auth.userId, organizationId: tenant.organizationId, ip: req.ip ?? 'unknown' },
      params.invitationId,
    );
  }
}

/**
 * The invitation link for the person invited. The token travels in the body, never in the URL, so
 * it stays out of access logs. Outside `/organizations/{id}` on purpose: the caller is not a
 * member yet.
 */
@Controller('api/v1/invitations')
@UseGuards(IdentityEnabledGuard)
export class InvitationLinksController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Post('preview')
  @HttpCode(200)
  preview(@Body() body: TokenDto, @Req() req: Request): Promise<InvitationPreview> {
    return this.invitations.preview(body.token, req.ip ?? 'unknown');
  }

  @Post('accept')
  @HttpCode(200)
  accept(
    @Body() body: TokenDto,
    @CurrentAuth() auth: AuthSession,
    @Req() req: Request,
  ): Promise<OrganizationSummary> {
    return this.invitations.accept(auth.userId, body.token, req.ip ?? 'unknown');
  }
}
