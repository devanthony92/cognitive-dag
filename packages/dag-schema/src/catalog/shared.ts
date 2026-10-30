import { z } from 'zod';
import type { DagType } from '../types.js';

/** Phase in which a node type becomes executable (FR-002). */
export type ExecutableFrom = 'F3' | 'F5' | 'F7';

export type NodeCategory = 'trigger' | 'llm' | 'logic' | 'human' | 'integration' | 'mock';

export interface NodeTypeDefinition<TType extends string = string, TConfig = unknown> {
  type: TType;
  /** Spanish name shown in the palette. */
  label: string;
  /** Spanish one-line description shown in the palette. */
  description: string;
  category: NodeCategory;
  executableFrom: ExecutableFrom;
  /** False for triggers: no connection may end in them. */
  acceptsInput: boolean;
  /** Output handles a connection can start from. */
  handles: readonly string[];
  /** Configuration fields (top level) where `{{reference}}` templates are allowed. */
  templatableFields: readonly string[];
  /** Spanish caption of each configuration field, used in messages and in the editor. */
  fieldLabels: Readonly<Record<string, string>>;
  /** For list fields, how one item reads in a message, with its article: `La etiqueta`. */
  itemLabels?: Readonly<Record<string, string>>;
  configSchema: z.ZodType<TConfig>;
  defaultConfig(): TConfig;
  /** Type of the node output computed from its configuration, or null when it has none. */
  outputSchema(config: TConfig): DagType | null;
}

/** Entry stored in the catalog: the config is only known to be valid after `configSchema`. */
export type CatalogEntry = NodeTypeDefinition<string, unknown>;

export function defineNode<TType extends string, TConfig>(
  definition: NodeTypeDefinition<TType, TConfig>,
): NodeTypeDefinition<TType, unknown> {
  return definition;
}

/** Text that may contain `{{reference}}` markers. */
export const templateText = (max = 10_000) => z.string().min(1).max(max);

export const object = (fields: Record<string, DagType>): DagType => ({ kind: 'object', fields });
