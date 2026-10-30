import { Inject, Injectable } from '@nestjs/common';
import {
  active,
  and,
  desc,
  eq,
  inArray,
  users,
  workflowActiveVersions,
  workflowVersions,
  type DatabaseClient,
  type Tx,
} from '@cognitive-dag/db';
import type { VersionBody, VersionSummary } from '@cognitive-dag/contracts';
import { isCheckViolation, isUniqueViolation } from '../auth/pg-errors';
import {
  DagInvalidException,
  DraftConflictException,
  LimitExceededException,
  ResourceNotFoundException,
} from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { definitionHash } from './canonical-json';
import { LimitsService } from './limits.service';
import { validateDraft } from './workflow-mappers';
import { findActiveWorkflow } from './workflow-queries';
import type { WorkflowActor } from './workflows.service';

type VersionRow = typeof workflowVersions.$inferSelect;

const NUMBER_KEY = 'workflow_versions_workflow_number_key';
const DEFINITION_SIZE_CHECK = 'workflow_versions_definition_size';
const UNKNOWN_AUTHOR = 'Usuario desconocido';

@Injectable()
export class VersionsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    private readonly limits: LimitsService,
    private readonly events: SecurityEventLogger,
  ) {}

  list(actor: WorkflowActor, workflowId: string): Promise<VersionSummary[]> {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        await findActiveWorkflow(tx, actor.organizationId, workflowId);
        const rows = await tx
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.workflowId, workflowId))
          .orderBy(desc(workflowVersions.versionNumber));
        const activeId = await activeVersionId(tx, workflowId);
        const authors = await authorNames(
          tx,
          rows.map((row) => row.publishedBy),
        );
        return rows.map((row) => toVersionSummary(row, row.id === activeId, authors));
      },
    );
  }

  get(actor: WorkflowActor, workflowId: string, versionNumber: number): Promise<VersionBody> {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        await findActiveWorkflow(tx, actor.organizationId, workflowId);
        const row = await findVersion(tx, workflowId, versionNumber);
        const activeId = await activeVersionId(tx, workflowId);
        const authors = await authorNames(tx, [row.publishedBy]);
        return {
          ...toVersionSummary(row, row.id === activeId, authors),
          definition: row.definition as Record<string, unknown>,
        };
      },
    );
  }

  /**
   * Publishing is one transaction (research R11): the workflow row is locked, the revision is
   * compared, the draft is validated with the limits in force, the next number is taken, and the
   * version is inserted and activated. A second publication of the same draft waits for the lock,
   * finds the version already there and is refused, so only one version is created.
   */
  async publish(
    actor: WorkflowActor,
    workflowId: string,
    expectedRevision: number,
    note: string | undefined,
  ): Promise<VersionSummary> {
    const summary = await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const workflow = await findActiveWorkflow(tx, actor.organizationId, workflowId, {
          lock: true,
        });
        if (workflow.draftRevision !== expectedRevision) throw new DraftConflictException();

        const limits = await this.limits.effectiveIn(tx, actor.organizationId);
        const validation = validateDraft(workflow.draftDefinition, limits);
        if (!validation.valid || !validation.definition) {
          throw new DagInvalidException(validation.errors);
        }
        const definition = validation.definition;
        const hash = definitionHash(definition);

        const [latest] = await tx
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.workflowId, workflowId))
          .orderBy(desc(workflowVersions.versionNumber))
          .limit(1);
        if (latest?.definitionHash.equals(hash)) {
          throw new DraftConflictException(
            `El borrador ya está publicado como la versión ${latest.versionNumber}. Actívala en lugar de publicar de nuevo.`,
          );
        }

        let version: VersionRow | undefined;
        try {
          [version] = await tx
            .insert(workflowVersions)
            .values({
              organizationId: actor.organizationId,
              workflowId,
              versionNumber: (latest?.versionNumber ?? 0) + 1,
              definition,
              definitionHash: hash,
              note: note?.length ? note : null,
              nodeCount: definition.nodes.length,
              edgeCount: definition.edges.length,
              nodeTypes: [...new Set(definition.nodes.map((node) => node.type))].sort(),
              publishedBy: actor.userId,
            })
            .returning();
        } catch (error) {
          if (isUniqueViolation(error, NUMBER_KEY)) throw new DraftConflictException();
          if (isCheckViolation(error, DEFINITION_SIZE_CHECK)) {
            throw new LimitExceededException(
              'La definición supera el tamaño máximo de la plataforma.',
            );
          }
          throw error;
        }
        if (!version) throw new Error('INSERT INTO workflow_versions returned no row');

        await setActive(tx, workflowId, version.id, actor.userId);
        const authors = await authorNames(tx, [actor.userId]);
        return toVersionSummary(version, true, authors);
      },
    );
    this.events.emit({
      event: 'workflow.published',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
    return summary;
  }

  /** Makes an existing version the active one; no version is created (FR-014). */
  async activate(
    actor: WorkflowActor,
    workflowId: string,
    versionNumber: number,
  ): Promise<VersionSummary> {
    const summary = await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        await findActiveWorkflow(tx, actor.organizationId, workflowId, { lock: true });
        const version = await findVersion(tx, workflowId, versionNumber);
        await setActive(tx, workflowId, version.id, actor.userId);
        const authors = await authorNames(tx, [version.publishedBy]);
        return toVersionSummary(version, true, authors);
      },
    );
    this.events.emit({
      event: 'workflow.version_activated',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
    return summary;
  }
}

async function findVersion(tx: Tx, workflowId: string, versionNumber: number): Promise<VersionRow> {
  const [row] = await tx
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, workflowId),
        eq(workflowVersions.versionNumber, versionNumber),
      ),
    );
  if (!row) throw new ResourceNotFoundException();
  return row;
}

async function activeVersionId(tx: Tx, workflowId: string): Promise<string | null> {
  const [bridge] = await tx
    .select()
    .from(workflowActiveVersions)
    .where(eq(workflowActiveVersions.workflowId, workflowId));
  return bridge?.versionId ?? null;
}

/** The composite foreign key guarantees the version belongs to this workflow. */
async function setActive(
  tx: Tx,
  workflowId: string,
  versionId: string,
  userId: string,
): Promise<void> {
  const updated = await tx
    .update(workflowActiveVersions)
    .set({ versionId, activatedBy: userId, activatedAt: new Date() })
    .where(eq(workflowActiveVersions.workflowId, workflowId))
    .returning({ workflowId: workflowActiveVersions.workflowId });
  if (updated.length === 0) throw new Error(`Workflow ${workflowId} has no active-version row`);
}

async function authorNames(tx: Tx, userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await active.users(tx, inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

function toVersionSummary(
  row: VersionRow,
  isActiveVersion: boolean,
  authors: Map<string, string>,
): VersionSummary {
  return {
    number: row.versionNumber,
    note: row.note,
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: { id: row.publishedBy, name: authors.get(row.publishedBy) ?? UNKNOWN_AUTHOR },
    nodeCount: row.nodeCount,
    edgeCount: row.edgeCount,
    nodeTypes: row.nodeTypes,
    active: isActiveVersion,
  };
}
