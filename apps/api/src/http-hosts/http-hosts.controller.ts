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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  AddHttpAllowedHostRequestSchema,
  type HttpAllowedHost,
  type HttpAllowedHostList,
} from '@cognitive-dag/contracts';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import { RequiredRoles } from '../organizations/required-roles.decorator';
import type { RequestTenant } from '../organizations/tenant-context';
import { HttpHostsService, type HttpHostActor } from './http-hosts.service';

class AddHostDto extends createZodDto(AddHttpAllowedHostRequestSchema) {}
class HostParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), hostId: z.uuid() }),
) {}

const actorOf = (auth: AuthSession, tenant: RequestTenant, req: Request): HttpHostActor => ({
  userId: auth.userId,
  organizationId: tenant.organizationId,
  ip: req.ip ?? 'unknown',
});

@Controller('api/v1/organizations/:organizationId/http-allowed-hosts')
@UseGuards(OrganizationGuard)
export class HttpHostsController {
  constructor(private readonly hosts: HttpHostsService) {}

  @Get()
  @RequiredRoles('owner', 'editor')
  list(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<HttpAllowedHostList> {
    return this.hosts.list(actorOf(auth, tenant, req));
  }

  @Post()
  @HttpCode(201)
  @RequiredRoles('owner')
  add(
    @Body() body: AddHostDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<HttpAllowedHost> {
    return this.hosts.add(actorOf(auth, tenant, req), body.pattern);
  }

  @Delete(':hostId')
  @HttpCode(204)
  @RequiredRoles('owner')
  async remove(
    @Param() params: HostParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<void> {
    await this.hosts.remove(actorOf(auth, tenant, req), params.hostId);
  }
}
