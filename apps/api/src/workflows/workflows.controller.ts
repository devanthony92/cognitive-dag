import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  SaveDraftResponse,
  VersionBody,
  VersionSummary,
  WorkflowBody,
  WorkflowSummary,
} from '@cognitive-dag/contracts';
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import { RequiredRoles } from '../organizations/required-roles.decorator';
import type { RequestTenant } from '../organizations/tenant-context';
import { DagEditorEnabledGuard } from './dag-editor-enabled.guard';
import { IfMatchRevision } from './if-match.decorator';
import { VersionsService } from './versions.service';
import {
  CreateWorkflowDto,
  PublishVersionDto,
  RenameWorkflowDto,
  SaveDraftDto,
  VersionParamsDto,
  WorkflowParamsDto,
} from './workflows.dto';
import { etagOf } from './workflow-mappers';
import { WorkflowsService, type WorkflowActor } from './workflows.service';

const actorOf = (auth: AuthSession, tenant: RequestTenant, req: Request): WorkflowActor => ({
  userId: auth.userId,
  organizationId: tenant.organizationId,
  ip: req.ip ?? 'unknown',
});

/**
 * Workflows of an organization (F2). Behind `dag-editor-enabled`; owner and editor write, viewer
 * reads, and only the owner archives. The organization guard answers 404 to non-members.
 */
@Controller('api/v1/organizations/:organizationId/workflows')
@UseGuards(IdentityEnabledGuard, DagEditorEnabledGuard, OrganizationGuard)
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly versions: VersionsService,
  ) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<WorkflowSummary[]> {
    return this.workflows.list(actorOf(auth, tenant, req));
  }

  @Post()
  @HttpCode(201)
  @RequiredRoles('owner', 'editor')
  async create(
    @Body() body: CreateWorkflowDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkflowBody> {
    const workflow = await this.workflows.create(actorOf(auth, tenant, req), body.name);
    res.setHeader('ETag', etagOf(workflow.draftRevision));
    res.location(`/api/v1/organizations/${tenant.organizationId}/workflows/${workflow.id}`);
    return workflow;
  }

  @Get(':workflowId')
  async get(
    @Param() params: WorkflowParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkflowBody> {
    const workflow = await this.workflows.get(actorOf(auth, tenant, req), params.workflowId);
    res.setHeader('ETag', etagOf(workflow.draftRevision));
    return workflow;
  }

  @Patch(':workflowId')
  @RequiredRoles('owner', 'editor')
  rename(
    @Param() params: WorkflowParamsDto,
    @Body() body: RenameWorkflowDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<WorkflowSummary> {
    return this.workflows.rename(actorOf(auth, tenant, req), params.workflowId, body.name);
  }

  @Delete(':workflowId')
  @HttpCode(204)
  @RequiredRoles('owner')
  archive(
    @Param() params: WorkflowParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<void> {
    return this.workflows.archive(actorOf(auth, tenant, req), params.workflowId);
  }

  @Put(':workflowId/draft')
  @RequiredRoles('owner', 'editor')
  async saveDraft(
    @Param() params: WorkflowParamsDto,
    @IfMatchRevision() revision: number,
    @Body() body: SaveDraftDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaveDraftResponse> {
    const saved = await this.workflows.saveDraft(
      actorOf(auth, tenant, req),
      params.workflowId,
      revision,
      body.definition,
    );
    res.setHeader('ETag', etagOf(saved.revision));
    return saved;
  }

  @Post(':workflowId/draft/from-version/:versionNumber')
  @HttpCode(200)
  @RequiredRoles('owner', 'editor')
  async copyVersionToDraft(
    @Param() params: VersionParamsDto,
    @IfMatchRevision() revision: number,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkflowBody> {
    const workflow = await this.workflows.copyVersionToDraft(
      actorOf(auth, tenant, req),
      params.workflowId,
      params.versionNumber,
      revision,
    );
    res.setHeader('ETag', etagOf(workflow.draftRevision));
    return workflow;
  }

  @Get(':workflowId/versions')
  listVersions(
    @Param() params: WorkflowParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<VersionSummary[]> {
    return this.versions.list(actorOf(auth, tenant, req), params.workflowId);
  }

  @Post(':workflowId/versions')
  @HttpCode(201)
  @RequiredRoles('owner', 'editor')
  publish(
    @Param() params: WorkflowParamsDto,
    @IfMatchRevision() revision: number,
    @Body() body: PublishVersionDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<VersionSummary> {
    return this.versions.publish(
      actorOf(auth, tenant, req),
      params.workflowId,
      revision,
      body.note,
    );
  }

  @Get(':workflowId/versions/:versionNumber')
  getVersion(
    @Param() params: VersionParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<VersionBody> {
    return this.versions.get(actorOf(auth, tenant, req), params.workflowId, params.versionNumber);
  }

  @Post(':workflowId/versions/:versionNumber/activate')
  @HttpCode(200)
  @RequiredRoles('owner', 'editor')
  activate(
    @Param() params: VersionParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<VersionSummary> {
    return this.versions.activate(
      actorOf(auth, tenant, req),
      params.workflowId,
      params.versionNumber,
    );
  }
}
