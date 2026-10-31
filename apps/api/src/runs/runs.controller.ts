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
import { IdentityEnabledGuard } from '../auth/identity-enabled.guard';
import { CurrentAuth, CurrentTenant } from '../auth/request-context';
import type { AuthSession } from '../auth/session.service';
import { OrganizationGuard } from '../organizations/organization.guard';
import type { RequestTenant } from '../organizations/tenant-context';
import { ExecutionEnabledGuard } from './execution-enabled.guard';
import { ResilienceEnabledGuard } from './resilience-enabled.guard';
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
 * Runs of an organization (F3). Behind `execution-enabled`. Any member may run, cancel and rerun
 * (author decision, to be reviewed in F7); the organization guard answers 404 to non-members, so
 * a run of another organization never shows up, SSE included.
 */
@Controller('api/v1/organizations/:organizationId')
@UseGuards(IdentityEnabledGuard, ExecutionEnabledGuard, OrganizationGuard)
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly runEvents: RunEventsService,
  ) {}

  @Post('workflows/:workflowId/runs')
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

  /** Review queue of the organization (F4). Behind `resilience-enabled`. */
  @Get('runs')
  @UseGuards(ResilienceEnabledGuard)
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
