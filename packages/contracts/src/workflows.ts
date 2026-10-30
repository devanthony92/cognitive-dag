import { z } from 'zod';

export const WorkflowNameSchema = z
  .string()
  .trim()
  .min(1, 'Debe tener entre 1 y 100 caracteres.')
  .max(100, 'Debe tener entre 1 y 100 caracteres.');

export const CreateWorkflowRequestSchema = z.strictObject({ name: WorkflowNameSchema });
export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;

export const RenameWorkflowRequestSchema = z.strictObject({ name: WorkflowNameSchema });
export type RenameWorkflowRequest = z.infer<typeof RenameWorkflowRequestSchema>;

/**
 * The envelope is strict; the definition itself is checked by `@cognitive-dag/dag-schema` in the
 * service, which is the single authority on its shape (research R1, FR-011).
 */
export const SaveDraftRequestSchema = z.strictObject({
  definition: z.record(z.string(), z.unknown()),
});
export type SaveDraftRequest = z.infer<typeof SaveDraftRequestSchema>;

/** The body of a publication is optional: a missing body means no note. */
export const PublishVersionRequestSchema = z
  .strictObject({
    note: z.string().trim().max(500, 'Debe tener como máximo 500 caracteres.').optional(),
  })
  .default({});
export type PublishVersionRequest = z.infer<typeof PublishVersionRequestSchema>;

/** Same shape as `DagError` in `@cognitive-dag/dag-schema`; contracts does not depend on it. */
export const DagErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  location: z.object({
    node: z.string().optional(),
    field: z.string().optional(),
    edge: z.string().optional(),
    nodes: z.array(z.string()).optional(),
  }),
});
export type DagErrorBody = z.infer<typeof DagErrorSchema>;

export const DraftValidationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(DagErrorSchema),
});
export type DraftValidation = z.infer<typeof DraftValidationSchema>;

export const WorkflowSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  draftRevision: z.int().min(1),
  draftUpdatedAt: z.iso.datetime(),
  activeVersionNumber: z.int().min(1).nullable(),
});
export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>;

export const WorkflowSchema = WorkflowSummarySchema.extend({
  draft: z.record(z.string(), z.unknown()),
  draftValidation: DraftValidationSchema.optional(),
});
export type WorkflowBody = z.infer<typeof WorkflowSchema>;

export const SaveDraftResponseSchema = z.object({
  revision: z.int().min(1),
  validation: DraftValidationSchema,
});
export type SaveDraftResponse = z.infer<typeof SaveDraftResponseSchema>;

export const VersionSummarySchema = z.object({
  number: z.int().min(1),
  note: z.string().nullable(),
  publishedAt: z.iso.datetime(),
  publishedBy: z.object({ id: z.uuid(), name: z.string() }),
  nodeCount: z.int().min(1),
  edgeCount: z.int().min(0),
  nodeTypes: z.array(z.string()),
  active: z.boolean(),
});
export type VersionSummary = z.infer<typeof VersionSummarySchema>;

export const VersionSchema = VersionSummarySchema.extend({
  definition: z.record(z.string(), z.unknown()),
});
export type VersionBody = z.infer<typeof VersionSchema>;

export const LimitsSchema = z.object({
  maxNodes: z.int(),
  maxEdges: z.int(),
  maxDefinitionBytes: z.int(),
  source: z.enum(['default', 'organization']),
});
export type LimitsBody = z.infer<typeof LimitsSchema>;
