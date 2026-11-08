import type { DagDefinition } from '../definition.js';

/** Longest an approval node waits: the bound of `timeoutSeconds` in the catalog (30 days). */
export const APPROVAL_TIMEOUT_MAX_SECONDS = 2_592_000;

/**
 * The time a run may spend waiting for people (F7, research R8): the sum of the deadlines of its
 * `human.approval` nodes. The nodes of a DAG without cycles run once, so the sum is a valid upper
 * bound. The caller adds it to the base duration of a run (`maxDurationMs`) and to the hard timeout
 * of the workflow, so a long approval does not make the run time out while it waits.
 */
export function approvalWaitBudgetMs(definition: Pick<DagDefinition, 'nodes'>): number {
  let total = 0;
  for (const node of definition.nodes) {
    if (node.type !== 'human.approval') continue;
    const { timeoutSeconds } = node.config as { timeoutSeconds?: number };
    total += (timeoutSeconds ?? APPROVAL_TIMEOUT_MAX_SECONDS) * 1000;
  }
  return total;
}
