import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { PingExecution } from '@cognitive-dag/contracts';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { CurrentTenant } from '../auth/request-context';
import { FlagsService } from '../flags/flags.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import { RequiredRoles } from '../organizations/required-roles.decorator';
import type { RequestTenant } from '../organizations/tenant-context';
import { createPing } from './ping-create';
import { CreatePingDto, OrganizationPingParamsDto } from './ping.dto';
import { PingService } from './ping.service';

/**
 * The ping with identity on: it needs a session and an active membership, and a ping is visible
 * only inside the organization that started it. Starting one needs owner or editor.
 */
@Controller('api/v1/organizations/:organizationId/pings')
@UseGuards(IdentityEnabledGuard, OrganizationGuard)
export class OrganizationPingController {
  constructor(
    private readonly pings: PingService,
    private readonly flags: FlagsService,
    private readonly cls: ClsService,
  ) {}

  @Post()
  @HttpCode(202)
  @RequiredRoles('owner', 'editor')
  async create(
    @Body() body: CreatePingDto,
    @Headers() rawHeaders: Record<string, unknown>,
    @CurrentTenant() tenant: RequestTenant,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PingExecution> {
    const ping = await createPing(
      { pings: this.pings, flags: this.flags, cls: this.cls },
      {
        rawHeaders,
        message: body.message,
        organizationId: tenant.organizationId,
      },
    );
    res.location(`/api/v1/organizations/${tenant.organizationId}/pings/${ping.pingId}`);
    return ping;
  }

  @Get(':pingId')
  get(
    @Param() params: OrganizationPingParamsDto,
    @CurrentTenant() tenant: RequestTenant,
  ): Promise<PingExecution> {
    return this.pings.get(params.pingId, tenant.organizationId);
  }
}
