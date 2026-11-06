import type { DagError } from '@cognitive-dag/dag-schema';
import type { IntermediateDag } from './intermediate.js';
import { edgeIds } from './translate.js';

const MAX_REPAIR_ISSUES = 10;

/** English hint per validation code; prefixes cover families of codes. */
const HINTS: readonly [string, string][] = [
  [
    'CYCLE_DETECTED',
    'the connections form a cycle; a connection never goes back to an earlier node',
  ],
  ['TRIGGER_MISSING', 'add exactly one trigger node'],
  ['TRIGGER_MULTIPLE', 'use exactly one trigger node'],
  ['TRIGGER_HAS_INPUT', 'no connection may end in a trigger'],
  ['NODE_UNREACHABLE', 'every node must be reachable from the trigger'],
  ['EDGE_SOURCE_NOT_FOUND', 'the connection starts at a node id that does not exist'],
  ['EDGE_TARGET_NOT_FOUND', 'the connection ends at a node id that does not exist'],
  ['EDGE_HANDLE_INVALID', 'fromHandle must be one of the output handles of the source type'],
  ['DUPLICATE_NODE_ID', 'node ids must be unique'],
  ['DUPLICATE_EDGE_ID', 'remove the repeated connection'],
  ['SCHEMA_INVALID', 'the config does not follow the guide of its type'],
  ['UNKNOWN_FIELD', 'the config has a field its type does not accept'],
  ['SECRET_FIELD', 'never put credentials in the config'],
  ['LIMIT_', 'the DAG is too large; simplify it'],
  [
    'REFERENCE_',
    'a reference must be nodes.<id>.output.<field> of an earlier node that has that field',
  ],
  ['TEMPLATE_', 'a {{reference}} marker is malformed'],
  ['CONDITION_', 'the condition is malformed or compares different types'],
];

function hintOf(code: string): string {
  return HINTS.find(([prefix]) => code.startsWith(prefix))?.[1] ?? 'fix this error';
}

/**
 * Turns validation errors into the repair turn (research R7). Only codes, positions in the
 * answer (`nodes[2]`, `edges[0]`), configuration paths and fixed English hints: never the Spanish
 * messages, labels or ids, which can echo the intent. Field names of unknown fields are dropped
 * for the same reason.
 */
export function repairIssues(errors: readonly DagError[], dag: IntermediateDag): string[] {
  const nodeIndex = new Map<string, number>();
  dag.nodes.forEach((node, index) => {
    if (!nodeIndex.has(node.id)) nodeIndex.set(node.id, index);
  });
  const edgeIndex = new Map(edgeIds(dag.edges).map((id, index) => [id, index]));
  const nodeRef = (id: string) => {
    const index = nodeIndex.get(id);
    return index === undefined ? 'nodes[?]' : `nodes[${index}]`;
  };

  const lines = errors.map((error) => {
    const { node, field, edge, nodes } = error.location;
    let where = 'dag';
    if (node !== undefined) {
      where = nodeRef(node);
      if (field !== undefined) {
        where += error.code === 'UNKNOWN_FIELD' ? '.config' : `.config.${field}`;
      }
    } else if (edge !== undefined) {
      const index = edgeIndex.get(edge);
      where = index === undefined ? 'edges[?]' : `edges[${index}]`;
    } else if (nodes !== undefined && nodes.length > 0) {
      where = nodes.map(nodeRef).join(', ');
    }
    return `${where}: ${error.code} - ${hintOf(error.code)}`;
  });
  return [...new Set(lines)].slice(0, MAX_REPAIR_ISSUES);
}
