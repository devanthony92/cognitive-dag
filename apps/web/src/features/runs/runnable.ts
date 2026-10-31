import { NODE_CATALOG, findUnsupportedNodes } from '@cognitive-dag/dag-schema';
import type { ProblemDetails } from '@cognitive-dag/contracts';
import { toEditableDefinition } from '../workflows/model';

export const RUN_TEXT = {
  noVersion: 'Publica una versión del workflow para poder ejecutarlo.',
  archived: 'El workflow está archivado y no se puede ejecutar.',
  invalidInput: 'Revisa los campos marcados: la entrada no es válida.',
} as const;

interface Blocking {
  nodeId: string;
  type: string;
  executableFrom: string;
}

function unsupportedText(nodes: readonly Blocking[]): string {
  const names = nodes.slice(0, 3).map((node) => {
    const label = (NODE_CATALOG as Record<string, { label: string } | undefined>)[node.type]?.label;
    return `${label ?? node.type} (desde ${node.executableFrom})`;
  });
  const more = nodes.length > 3 ? ` y ${nodes.length - 3} más` : '';
  return `La versión activa tiene nodos que aún no se pueden ejecutar: ${names.join(', ')}${more}.`;
}

/**
 * Why the active version cannot run, or undefined when it can. Mirrors the API check (FR-001,
 * FR-002) so the button explains itself before anyone clicks; the API still decides.
 */
export function runBlockReason(
  activeDefinition: unknown,
  hasActiveVersion: boolean,
): string | undefined {
  if (!hasActiveVersion) return RUN_TEXT.noVersion;
  if (activeDefinition === undefined) return undefined;
  const unsupported = findUnsupportedNodes(toEditableDefinition(activeDefinition).definition);
  return unsupported.length > 0 ? unsupportedText(unsupported) : undefined;
}

/** The API's WORKFLOW_NOT_RUNNABLE problem, in the words of the screen. */
export function notRunnableMessage(problem: ProblemDetails): string {
  if (problem.reason === 'no_active_version') return RUN_TEXT.noVersion;
  if (problem.reason === 'archived') return RUN_TEXT.archived;
  if (problem.reason === 'unsupported_nodes' && problem.nodes)
    return unsupportedText(problem.nodes);
  return problem.detail;
}
