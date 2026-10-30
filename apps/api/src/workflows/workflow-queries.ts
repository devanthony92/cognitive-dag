import {
  active,
  and,
  eq,
  inArray,
  workflowActiveVersions,
  workflowVersions,
  type Tx,
  workflows,
} from '@cognitive-dag/db';
import { ResourceNotFoundException } from '../common/errors/domain.exception';

export type WorkflowRow = typeof workflows.$inferSelect;

/** The non-archived workflow of the organization, or the same 404 as one that does not exist. */
export async function findActiveWorkflow(
  tx: Tx,
  organizationId: string,
  workflowId: string,
  options: { lock?: boolean } = {},
): Promise<WorkflowRow> {
  const query = active.workflows(
    tx,
    and(eq(workflows.id, workflowId), eq(workflows.organizationId, organizationId)),
  );
  const [row] = await (options.lock ? query.for('update') : query);
  if (!row) throw new ResourceNotFoundException();
  return row;
}

/** Number of the active version of each workflow; absent when none is active. */
export async function activeVersionNumbers(
  tx: Tx,
  workflowIds: string[],
): Promise<Map<string, number>> {
  if (workflowIds.length === 0) return new Map();
  const bridges = await tx
    .select()
    .from(workflowActiveVersions)
    .where(inArray(workflowActiveVersions.workflowId, workflowIds));
  const versionIds = bridges.flatMap((bridge) => (bridge.versionId ? [bridge.versionId] : []));
  if (versionIds.length === 0) return new Map();
  const versions = await tx
    .select({ id: workflowVersions.id, number: workflowVersions.versionNumber })
    .from(workflowVersions)
    .where(inArray(workflowVersions.id, versionIds));
  const numbers = new Map(versions.map((version) => [version.id, version.number]));
  return new Map(
    bridges.flatMap((bridge) => {
      const number = bridge.versionId ? numbers.get(bridge.versionId) : undefined;
      return number === undefined ? [] : [[bridge.workflowId, number] as const];
    }),
  );
}
