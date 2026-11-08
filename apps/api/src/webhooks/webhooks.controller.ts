import { Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Webhook, WebhookAccepted, WebhookWithToken } from '@cognitive-dag/contracts';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { Public, SkipCsrf } from '../auth/public.decorator';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import { RequiredRoles } from '../organizations/required-roles.decorator';
import type { RequestTenant } from '../organizations/tenant-context';
import { TriggersEnabledGuard } from '../triggers/triggers-enabled.guard';
import { WorkflowTriggerParamsDto } from '../triggers/triggers.dto';
import { WebhookTokenService } from './webhook-token.service';
import { WebhooksService } from './webhooks.service';

/**
 * The public endpoint (F7): no session and no CSRF, since the token in the path is the credential.
 * The path parameters are read as plain strings on purpose: validating their shape here would make
 * a malformed token answer differently from a wrong one.
 */
@Controller('api/v1/hooks')
@Public()
@SkipCsrf()
@UseGuards(TriggersEnabledGuard)
export class HooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post(':triggerId/:token')
  async fire(
    @Param('triggerId') triggerId: string,
    @Param('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebhookAccepted> {
    const result = await this.webhooks.fire({ triggerId, token, ip: req.ip ?? 'unknown', req });
    res.status(result.duplicate ? 200 : 202);
    return result;
  }
}

/** Token management for the people of the organization: any role reads, owners and editors generate. */
@Controller('api/v1/organizations/:organizationId/workflows/:workflowId/webhook')
@UseGuards(IdentityEnabledGuard, TriggersEnabledGuard, OrganizationGuard)
export class WebhookTokenController {
  constructor(private readonly tokens: WebhookTokenService) {}

  @Get()
  get(
    @Param() params: WorkflowTriggerParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<Webhook> {
    return this.tokens.get(
      { userId: auth.userId, organizationId: tenant.organizationId, ip: req.ip ?? 'unknown' },
      params.workflowId,
    );
  }

  @Post('token')
  @HttpCode(201)
  @RequiredRoles('owner', 'editor')
  async regenerate(
    @Param() params: WorkflowTriggerParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebhookWithToken> {
    // The token is in this body and must not be kept by any cache.
    res.setHeader('Cache-Control', 'no-store');
    return this.tokens.regenerate(
      { userId: auth.userId, organizationId: tenant.organizationId, ip: req.ip ?? 'unknown' },
      params.workflowId,
    );
  }
}
