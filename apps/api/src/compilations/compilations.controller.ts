import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Compilation, CompilationList, CompilationResult } from '@cognitive-dag/contracts';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import { RequiredRoles } from '../organizations/required-roles.decorator';
import type { RequestTenant } from '../organizations/tenant-context';
import {
  CompilationParamsDto,
  CreateCompilationDto,
  ListCompilationsQueryDto,
} from './compilations.dto';
import { CompilationsService, type CompilationActor } from './compilations.service';

const actorOf = (auth: AuthSession, tenant: RequestTenant): CompilationActor => ({
  userId: auth.userId,
  organizationId: tenant.organizationId,
});

/**
 * Natural language to DAG (F6). Owners and editors compile (the
 * roles that edit drafts); any member reads. Applying the result is not here: it uses the
 * endpoints of workflows (F2). The organization guard answers 404 to non-members.
 */
@Controller('api/v1/organizations/:organizationId/compilations')
@UseGuards(OrganizationGuard)
export class CompilationsController {
  constructor(private readonly compilations: CompilationsService) {}

  @Post()
  @HttpCode(202)
  @RequiredRoles('owner', 'editor')
  async create(
    @Body() body: CreateCompilationDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Compilation> {
    const compilation = await this.compilations.create(actorOf(auth, tenant), body);
    res.location(`/api/v1/organizations/${tenant.organizationId}/compilations/${compilation.id}`);
    return compilation;
  }

  @Get()
  list(
    @Query() query: ListCompilationsQueryDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
  ): Promise<CompilationList> {
    return this.compilations.list(actorOf(auth, tenant), query.workflowId);
  }

  @Get(':compilationId')
  get(
    @Param() params: CompilationParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
  ): Promise<Compilation> {
    return this.compilations.get(actorOf(auth, tenant), params.compilationId);
  }

  @Get(':compilationId/result')
  result(
    @Param() params: CompilationParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
  ): Promise<CompilationResult> {
    return this.compilations.result(actorOf(auth, tenant), params.compilationId);
  }
}
