import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  OrganizationRunList,
  Run,
  RunDetail,
  RunList,
  StepIo,
} from '@cognitive-dag/contracts';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import { RequiredRoles } from '../organizations/required-roles.decorator';
import type { RequestTenant } from '../organizations/tenant-context';
import { RunEventsService } from './run-events.service';
import {
  ListRunsQueryDto,
  OrganizationRunsQueryDto,
  RerunDto,
  RunParamsDto,
  StartRunDto,
  StepIoParamsDto,
  WorkflowRunsParamsDto,
} from './runs.dto';
import { RunsService, type RunActor } from './runs.service';

const actorOf = (auth: AuthSession, tenant: RequestTenant, req: Request): RunActor => ({
  userId: auth.userId,
  organizationId: tenant.organizationId,
  ip: req.ip ?? 'unknown',
});

/**
 * Runs of an organization (F3). Only owner and editor start, cancel and
 * rerun (F8, ADR-0082, which replaces ADR-0053); every member reads. The organization guard
 * answers 404 to non-members, so a run of another organization never shows up, SSE included. A
 * route that changes state must declare its roles: `runs-roles.test.ts` fails otherwise (FR-008).
 */
@Controller('api/v1/organizations/:organizationId')
@UseGuards(OrganizationGuard)
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly runEvents: RunEventsService,
  ) {}

  @Post('workflows/:workflowId/runs')
  @RequiredRoles('owner', 'editor')
  @HttpCode(202)
  async start(
    @Param() params: WorkflowRunsParamsDto,
    @Body() body: StartRunDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Run> {
    const run = await this.runs.start(actorOf(auth, tenant, req), params.workflowId, body.input);
    res.location(`/api/v1/organizations/${tenant.organizationId}/runs/${run.id}`);
    return run;
  }

  @Get('workflows/:workflowId/runs')
  list(
    @Param() params: WorkflowRunsParamsDto,
    @Query() query: ListRunsQueryDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<RunList> {
    return this.runs.list(actorOf(auth, tenant, req), params.workflowId, query.cursor, query.limit);
  }

  /** Review queue of the organization (F4). */
  @Get('runs')
  listOrganization(
    @Query() query: OrganizationRunsQueryDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<OrganizationRunList> {
    return this.runs.listOrganization(actorOf(auth, tenant, req), {
      status: query.status,
      workflowId: query.workflowId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('runs/:runId')
  get(
    @Param() params: RunParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<RunDetail> {
    return this.runs.get(actorOf(auth, tenant, req), params.runId);
  }

  @Get('runs/:runId/steps/:nodeId/io')
  stepIo(
    @Param() params: StepIoParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<StepIo> {
    return this.runs.stepIo(actorOf(auth, tenant, req), params.runId, params.nodeId);
  }

  /** Streams until the run ends or the client leaves; the response is written by the service. */
  @Get('runs/:runId/events')
  async events(
    @Param() params: RunParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.runEvents.stream(actorOf(auth, tenant, req), params.runId, res);
  }

  @Post('runs/:runId/cancel')
  @RequiredRoles('owner', 'editor')
  @HttpCode(202)
  cancel(
    @Param() params: RunParamsDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
  ): Promise<Run> {
    return this.runs.cancel(actorOf(auth, tenant, req), params.runId);
  }

  @Post('runs/:runId/rerun')
  @RequiredRoles('owner', 'editor')
  @HttpCode(202)
  async rerun(
    @Param() params: RunParamsDto,
    @Body() body: RerunDto,
    @CurrentAuth() auth: AuthSession,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Run> {
    const run = await this.runs.rerun(actorOf(auth, tenant, req), params.runId, body.fromNodeId);
    res.location(`/api/v1/organizations/${tenant.organizationId}/runs/${run.id}`);
    return run;
  }
}
