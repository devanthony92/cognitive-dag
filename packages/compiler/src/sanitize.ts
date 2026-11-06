import { NODE_CATALOG, isNodeType } from '@cognitive-dag/dag-schema';
import type { IntermediateDag } from './intermediate.js';

export interface OmittedSensitiveField {
  nodeId: string;
  field: string;
}

/** Sensitive fields of a node type and the defaults used as placeholders while validating. */
export type SensitiveLookup = (
  type: string,
) => { sensitiveFields: readonly string[]; defaultConfig(): unknown } | undefined;

export const catalogSensitiveLookup: SensitiveLookup = (type) => {
  if (!isNodeType(type)) return undefined;
  const entry = NODE_CATALOG[type];
  return {
    sensitiveFields: entry.sensitiveFields ?? [],
    defaultConfig: () => entry.defaultConfig(),
  };
};

/**
 * Drops every sensitive field from the configuration (research R12) and lists all of them, filled
 * or not, so the person knows what to complete. The input is never mutated.
 */
export function stripSensitive(
  dag: IntermediateDag,
  lookup: SensitiveLookup = catalogSensitiveLookup,
): { dag: IntermediateDag; omitted: OmittedSensitiveField[] } {
  const omitted: OmittedSensitiveField[] = [];
  const nodes = dag.nodes.map((node) => {
    const fields = lookup(node.type)?.sensitiveFields ?? [];
    if (fields.length === 0) return node;
    const config = { ...node.config };
    for (const field of fields) {
      delete config[field];
      omitted.push({ nodeId: node.id, field });
    }
    return { ...node, config };
  });
  return { dag: { ...dag, nodes }, omitted };
}

/**
 * Replaces the sensitive fields with the defaults of the type, so the rest of the DAG can be
 * validated whatever the model wrote in them (or left out). Only used for the repair check.
 */
export function fillSensitivePlaceholders(
  dag: IntermediateDag,
  lookup: SensitiveLookup = catalogSensitiveLookup,
): IntermediateDag {
  return {
    ...dag,
    nodes: dag.nodes.map((node) => {
      const entry = lookup(node.type);
      if (!entry || entry.sensitiveFields.length === 0) return node;
      const defaults = (entry.defaultConfig() ?? {}) as Record<string, unknown>;
      const config = { ...node.config };
      for (const field of entry.sensitiveFields) {
        if (field in defaults) config[field] = defaults[field];
        else delete config[field];
      }
      return { ...node, config };
    }),
  };
}
