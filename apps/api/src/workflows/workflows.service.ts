import { Inject, Injectable } from '@nestjs/common';
import {
  active,
  and,
  eq,
  isActive,
  sql,
  workflowActiveVersions,
  workflowVersions,
  workflows,
  type DatabaseClient,
} from '@cognitive-dag/db';
import { definitionByteSize } from '@cognitive-dag/dag-schema';
import type { SaveDraftResponse, WorkflowBody, WorkflowSummary } from '@cognitive-dag/contracts';
import { isCheckViolation, isUniqueViolation } from '../auth/pg-errors';
import {
  DomainException,
  DraftConflictException,
  LimitExceededException,
  ResourceNotFoundException,
  WorkflowNameTakenException,
} from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { LimitsService } from './limits.service';
import { activeVersionNumbers, findActiveWorkflow } from './workflow-queries';
import { toSummary, toWorkflowBody, validateDraft } from './workflow-mappers';

/** Who acts, on which organization, from where. The organization guard already vouched for it. */
export interface WorkflowActor {
  userId: string;
  organizationId: string;
  ip: string;
}

const NAME_KEY = 'workflows_organization_name_active_key';
const DRAFT_SIZE_CHECK = 'workflows_draft_definition_size';

/** Error codes that make the server refuse a definition instead of saving it with errors. */
const LIMIT_CODES = new Set(['LIMIT_NODES', 'LIMIT_EDGES', 'LIMIT_BYTES']);
const FORBIDDEN_CODES = new Set(['UNKNOWN_FIELD', 'SECRET_FIELD']);

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    private readonly limits: LimitsService,
    private readonly events: SecurityEventLogger,
  ) {}

  list(actor: WorkflowActor): Promise<WorkflowSummary[]> {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const rows = await active.workflows(tx, eq(workflows.organizationId, actor.organizationId));
        const numbers = await activeVersionNumbers(
          tx,
          rows.map((row) => row.id),
        );
        return rows
          .map((row) => toSummary(row, numbers.get(row.id) ?? null))
          .sort((a, b) => a.name.localeCompare(b.name));
      },
    );
  }

  get(actor: WorkflowActor, workflowId: string): Promise<WorkflowBody> {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const row = await findActiveWorkflow(tx, actor.organizationId, workflowId);
        const numbers = await activeVersionNumbers(tx, [row.id]);
        const limits = await this.limits.effectiveIn(tx, actor.organizationId);
        return toWorkflowBody(row, numbers.get(row.id) ?? null, limits);
      },
    );
  }

  /** The workflow and its row in `workflow_active_versions` are created in one transaction. */
  async create(actor: WorkflowActor, name: string): Promise<WorkflowBody> {
    const body = await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        let row;
        try {
          [row] = await tx
            .insert(workflows)
            .values({
              organizationId: actor.organizationId,
              name,
              draftUpdatedBy: actor.userId,
              createdBy: actor.userId,
            })
            .returning();
        } catch (error) {
          if (isUniqueViolation(error, NAME_KEY)) throw new WorkflowNameTakenException();
          throw error;
        }
        if (!row) throw new Error('INSERT INTO workflows returned no row');
        await tx
          .insert(workflowActiveVersions)
          .values({ workflowId: row.id, organizationId: actor.organizationId });
        const limits = await this.limits.effectiveIn(tx, actor.organizationId);
        return toWorkflowBody(row, null, limits);
      },
    );
    this.events.emit({
      event: 'workflow.created',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
    return body;
  }

  rename(actor: WorkflowActor, workflowId: string, name: string): Promise<WorkflowSummary> {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        let row;
        try {
          [row] = await tx
            .update(workflows)
            .set({ name })
            .where(
              and(
                eq(workflows.id, workflowId),
                eq(workflows.organizationId, actor.organizationId),
                isActive.workflows,
              ),
            )
            .returning();
        } catch (error) {
          if (isUniqueViolation(error, NAME_KEY)) throw new WorkflowNameTakenException();
          throw error;
        }
        if (!row) throw new ResourceNotFoundException();
        const numbers = await activeVersionNumbers(tx, [row.id]);
        return toSummary(row, numbers.get(row.id) ?? null);
      },
    );
  }

  /** Soft delete; the trigger `workflows_archive_deactivates` clears the active version (FR-017). */
  async archive(actor: WorkflowActor, workflowId: string): Promise<void> {
    await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const archived = await tx
          .update(workflows)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(workflows.id, workflowId),
              eq(workflows.organizationId, actor.organizationId),
              isActive.workflows,
            ),
          )
          .returning({ id: workflows.id });
        if (archived.length === 0) throw new ResourceNotFoundException();
      },
    );
    this.events.emit({
      event: 'workflow.archived',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
  }

  /**
   * Saves the draft even when it has validation errors (FR-010) and returns them. What the server
   * never stores: a definition over the organization's limits (413), one with unknown fields or
   * credential-like keys, or one that is not even a DAG envelope (422).
   */
  saveDraft(
    actor: WorkflowActor,
    workflowId: string,
    expectedRevision: number,
    definition: Record<string, unknown>,
  ): Promise<SaveDraftResponse> {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const limits = await this.limits.effectiveIn(tx, actor.organizationId);

        const bytes = definitionByteSize(definition);
        if (bytes > limits.maxDefinitionBytes) {
          throw new LimitExceededException(
            `La definición pesa ${bytes} bytes y el máximo de la organización es ${limits.maxDefinitionBytes}.`,
          );
        }
        const validation = validateDraft(definition, limits);
        const overLimit = validation.errors.find((error) => LIMIT_CODES.has(error.code));
        if (overLimit) throw new LimitExceededException(overLimit.message);

        const forbidden = validation.errors.filter((error) => FORBIDDEN_CODES.has(error.code));
        if (forbidden.length > 0) {
          throw new DomainException(
            422,
            'VALIDATION_FAILED',
            'La solicitud contiene datos inválidos.',
            {
              errors: forbidden.map((error) => ({
                field: describeLocation(error.location),
                message: error.message,
              })),
            },
          );
        }
        if (!validation.definition && !hasEnvelope(definition)) {
          throw new DomainException(
            422,
            'VALIDATION_FAILED',
            'La solicitud contiene datos inválidos.',
            {
              errors: [
                {
                  field: 'definition',
                  message: 'Debe tener schemaVersion 1, una lista nodes y una lista edges.',
                },
              ],
            },
          );
        }

        let revision: number | undefined;
        try {
          const [updated] = await tx
            .update(workflows)
            .set({
              draftDefinition: validation.definition ?? definition,
              draftRevision: sql`${workflows.draftRevision} + 1`,
              draftUpdatedBy: actor.userId,
              draftUpdatedAt: new Date(),
            })
            .where(
              and(
                eq(workflows.id, workflowId),
                eq(workflows.organizationId, actor.organizationId),
                isActive.workflows,
                eq(workflows.draftRevision, expectedRevision),
              ),
            )
            .returning({ revision: workflows.draftRevision });
          revision = updated?.revision;
        } catch (error) {
          if (isCheckViolation(error, DRAFT_SIZE_CHECK)) {
            throw new LimitExceededException(
              'La definición supera el tamaño máximo de la plataforma.',
            );
          }
          throw error;
        }
        if (revision === undefined) await this.explainMiss(tx, actor.organizationId, workflowId);
        return {
          revision: revision as number,
          validation: { valid: validation.valid, errors: validation.errors },
        };
      },
    );
  }

  /** Replaces the draft with the definition of a version (R10 applies: needs the revision). */
  copyVersionToDraft(
    actor: WorkflowActor,
    workflowId: string,
    versionNumber: number,
    expectedRevision: number,
  ): Promise<WorkflowBody> {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        await findActiveWorkflow(tx, actor.organizationId, workflowId);
        const [version] = await tx
          .select()
          .from(workflowVersions)
          .where(
            and(
              eq(workflowVersions.workflowId, workflowId),
              eq(workflowVersions.versionNumber, versionNumber),
            ),
          );
        if (!version) throw new ResourceNotFoundException();

        const [updated] = await tx
          .update(workflows)
          .set({
            draftDefinition: version.definition,
            draftRevision: sql`${workflows.draftRevision} + 1`,
            draftUpdatedBy: actor.userId,
            draftUpdatedAt: new Date(),
          })
          .where(
            and(
              eq(workflows.id, workflowId),
              eq(workflows.organizationId, actor.organizationId),
              isActive.workflows,
              eq(workflows.draftRevision, expectedRevision),
            ),
          )
          .returning();
        if (!updated) throw new DraftConflictException();
        const numbers = await activeVersionNumbers(tx, [workflowId]);
        const limits = await this.limits.effectiveIn(tx, actor.organizationId);
        return toWorkflowBody(updated, numbers.get(workflowId) ?? null, limits);
      },
    );
  }

  /** A revision that matched nothing: the workflow is gone (404) or the draft moved on (409). */
  private async explainMiss(
    tx: Parameters<typeof findActiveWorkflow>[0],
    organizationId: string,
    workflowId: string,
  ): Promise<never> {
    await findActiveWorkflow(tx, organizationId, workflowId);
    throw new DraftConflictException();
  }
}

function hasEnvelope(definition: Record<string, unknown>): boolean {
  return (
    definition['schemaVersion'] === 1 &&
    Array.isArray(definition['nodes']) &&
    Array.isArray(definition['edges'])
  );
}

function describeLocation(location: { node?: string; edge?: string; field?: string }): string {
  const parts = ['definition'];
  if (location.node) parts.push(`nodes.${location.node}`);
  if (location.edge) parts.push(`edges.${location.edge}`);
  if (location.field) parts.push(location.field);
  return parts.join('.');
}
