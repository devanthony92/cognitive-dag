import { z } from 'zod';

export interface DagLimits {
  maxNodes: number;
  maxEdges: number;
  maxDefinitionBytes: number;
}

/** Applied to organizations without limits of their own. */
export const DEFAULT_LIMITS: Readonly<DagLimits> = Object.freeze({
  maxNodes: 50,
  maxEdges: 100,
  maxDefinitionBytes: 262_144,
});

/** Ceilings no organization can exceed, whoever changes its limits (research R12). */
export const ABSOLUTE_LIMITS: Readonly<DagLimits> = Object.freeze({
  maxNodes: 500,
  maxEdges: 1000,
  maxDefinitionBytes: 1_048_576,
});

export const DagLimitsSchema = z.strictObject({
  maxNodes: z.number().int().min(1).max(ABSOLUTE_LIMITS.maxNodes),
  maxEdges: z.number().int().min(0).max(ABSOLUTE_LIMITS.maxEdges),
  maxDefinitionBytes: z.number().int().min(1024).max(ABSOLUTE_LIMITS.maxDefinitionBytes),
});

/** Size in bytes of the JSON form of a definition (UTF-8). */
export function definitionByteSize(definition: unknown): number {
  return new TextEncoder().encode(JSON.stringify(definition)).length;
}
