import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  CreateCredentialRequestSchema,
  RotateCredentialRequestSchema,
  type Credential,
  type CredentialList,
} from '@cognitive-dag/contracts';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import { RequiredRoles } from '../organizations/required-roles.decorator';
import type { RequestTenant } from '../organizations/tenant-context';
import { CredentialsService, type CredentialActor } from './credentials.service';

class CreateCredentialDto extends createZodDto(CreateCredentialRequestSchema) {}
class RotateCredentialDto extends createZodDto(RotateCredentialRequestSchema) {}
class CredentialParamsDto extends createZodDto(
  z.object({ organizationId: z.uuid(), credentialId: z.uuid() }),
) {}

const actorOf = (auth: AuthSession, tenant: RequestTenant, req: Request): CredentialActor => ({
  userId: auth.userId,
  organizationId: tenant.organizationId,
  ip: req.ip ?? 'unknown',
});

/** Owners manage credentials; editors only see their metadata, to pick one in a node. */
@Controller('api/v1/organizations/:organizationId/credentials')
@UseGuards(OrganizationGuard)
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get()
  @RequiredRoles('owner', 'editor')
  list(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<CredentialList> {
    return this.credentials.list(actorOf(auth, tenant, req));
  }

  @Post()
  @HttpCode(201)
  @RequiredRoles('owner')
  create(
    @Body() body: CreateCredentialDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<Credential> {
    return this.credentials.create(actorOf(auth, tenant, req), body);
  }

  @Put(':credentialId')
  @RequiredRoles('owner')
  rotate(
    @Param() params: CredentialParamsDto,
    @Body() body: RotateCredentialDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<Credential> {
    return this.credentials.rotate(actorOf(auth, tenant, req), params.credentialId, body);
  }

  @Delete(':credentialId')
  @HttpCode(204)
  @RequiredRoles('owner')
  async archive(
    @Param() params: CredentialParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<void> {
    await this.credentials.archive(actorOf(auth, tenant, req), params.credentialId);
  }
}
