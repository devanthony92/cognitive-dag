import { httpRequest } from './http-request.js';
import { humanApproval } from './human-approval.js';
import { llmClassify } from './llm-classify.js';
import { llmExtract } from './llm-extract.js';
import { llmGenerate } from './llm-generate.js';
import { logicCondition } from './logic-condition.js';
import { logicMerge } from './logic-merge.js';
import { mockService } from './mock-service.js';
import type { RetryPolicy, RetrySetting } from './retry.js';
import type { CatalogEntry } from './shared.js';
import { triggerManual } from './trigger-manual.js';
import { triggerSchedule } from './trigger-schedule.js';
import { triggerWebhook } from './trigger-webhook.js';

export * from './retry.js';
export type { CatalogEntry, ExecutableFrom, NodeCategory, NodeTypeDefinition } from './shared.js';

const entries = [
  triggerManual,
  triggerWebhook,
  triggerSchedule,
  llmClassify,
  llmExtract,
  llmGenerate,
  logicCondition,
  logicMerge,
  humanApproval,
  httpRequest,
  mockService,
] as const;

export type NodeType = (typeof entries)[number]['type'];

export const NODE_TYPES = entries.map((entry) => entry.type) as readonly NodeType[];

/** The 11 node types of the plan, keyed by type (research R3). */
export const NODE_CATALOG = Object.fromEntries(
  entries.map((entry) => [entry.type, entry as CatalogEntry]),
) as Record<NodeType, CatalogEntry>;

/** True for the node types whose definition may carry a `retry` setting. */
export function supportsRetry(type: string): boolean {
  return isNodeType(type) && NODE_CATALOG[type].retryDefaults !== undefined;
}

/**
 * Policy a node runs with: the defaults of its type with the fields of its `retry` setting on
 * top. Undefined for nodes without effects.
 */
export function resolveRetryPolicy(
  type: string,
  setting: RetrySetting | undefined,
): RetryPolicy | undefined {
  if (!isNodeType(type)) return undefined;
  const defaults = NODE_CATALOG[type].retryDefaults;
  if (!defaults) return undefined;
  return {
    maxAttempts: setting?.maxAttempts ?? defaults.maxAttempts,
    timeoutSeconds: setting?.timeoutSeconds ?? defaults.timeoutSeconds,
    initialIntervalMs: setting?.initialIntervalMs ?? defaults.initialIntervalMs,
  };
}

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && Object.hasOwn(NODE_CATALOG, value);
}
