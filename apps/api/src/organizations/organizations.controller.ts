import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { OrganizationSummary } from '@cognitive-dag/contracts';
import { CurrentAuth } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { CreateOrganizationDto } from './organizations.dto';
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
}
