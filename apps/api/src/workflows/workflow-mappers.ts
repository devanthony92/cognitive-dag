import { validateDefinition, type ValidationResult } from '@cognitive-dag/dag-schema';
import type { LimitsBody, WorkflowBody, WorkflowSummary } from '@cognitive-dag/contracts';
import type { workflows } from '@cognitive-dag/db';
import { toDagLimits } from './limits.service';

type WorkflowRow = typeof workflows.$inferSelect;

export function toSummary(row: WorkflowRow, activeVersionNumber: number | null): WorkflowSummary {
  return {
    id: row.id,
    name: row.name,
    draftRevision: row.draftRevision,
    draftUpdatedAt: row.draftUpdatedAt.toISOString(),
    activeVersionNumber,
  };
}

/** Validates a stored draft against the limits in force; the result travels with the draft. */
export function validateDraft(draft: unknown, limits: LimitsBody): ValidationResult {
  return validateDefinition(draft, { limits: toDagLimits(limits) });
}

export function toWorkflowBody(
  row: WorkflowRow,
  activeVersionNumber: number | null,
  limits: LimitsBody,
): WorkflowBody {
  const validation = validateDraft(row.draftDefinition, limits);
  return {
    ...toSummary(row, activeVersionNumber),
    draft: row.draftDefinition as Record<string, unknown>,
    draftValidation: { valid: validation.valid, errors: validation.errors },
  };
}

/** The ETag of a draft is its revision, quoted (research R10). */
export const etagOf = (revision: number) => `"${revision}"`;
