import { queryOptions } from '@tanstack/react-query';
import {
  LimitsSchema,
  SaveDraftResponseSchema,
  VersionSchema,
  VersionSummarySchema,
  WorkflowSchema,
  WorkflowSummarySchema,
  type SaveDraftResponse,
  type VersionSummary,
  type WorkflowBody,
} from '@cognitive-dag/contracts';
import type { DagDefinition } from '@cognitive-dag/dag-schema';
import { request } from '../../api/client';

const base = (organizationId: string) => `/api/v1/organizations/${organizationId}`;

export const workflowsKey = (organizationId: string) => ['workflows', organizationId] as const;
export const workflowKey = (organizationId: string, workflowId: string) =>
  ['workflow', organizationId, workflowId] as const;
export const versionsKey = (organizationId: string, workflowId: string) =>
  ['workflow-versions', organizationId, workflowId] as const;

export const workflowsQuery = (organizationId: string) =>
  queryOptions({
    queryKey: workflowsKey(organizationId),
    queryFn: async () =>
      (await request(`${base(organizationId)}/workflows`, WorkflowSummarySchema.array())).data,
  });

/**
 * The editor copies the draft into its own state, so a refetch must never replace it behind the
 * user's back: the data is fresh forever and dropped when the editor closes.
 */
export const workflowQuery = (organizationId: string, workflowId: string) =>
  queryOptions({
    queryKey: workflowKey(organizationId, workflowId),
    queryFn: async () =>
      (await request(`${base(organizationId)}/workflows/${workflowId}`, WorkflowSchema)).data,
    staleTime: Infinity,
    gcTime: 0,
  });

export const versionsQuery = (organizationId: string, workflowId: string) =>
  queryOptions({
    queryKey: versionsKey(organizationId, workflowId),
    queryFn: async () =>
      (
        await request(
          `${base(organizationId)}/workflows/${workflowId}/versions`,
          VersionSummarySchema.array(),
        )
      ).data,
  });

/** A published version never changes, so it is fetched once. */
export const versionQuery = (organizationId: string, workflowId: string, versionNumber: number) =>
  queryOptions({
    queryKey: ['workflow-version', organizationId, workflowId, versionNumber] as const,
    queryFn: async () =>
      (
        await request(
          `${base(organizationId)}/workflows/${workflowId}/versions/${versionNumber}`,
          VersionSchema,
        )
      ).data,
    staleTime: Infinity,
  });

export const limitsQuery = (organizationId: string) =>
  queryOptions({
    queryKey: ['limits', organizationId] as const,
    queryFn: async () => (await request(`${base(organizationId)}/limits`, LimitsSchema)).data,
  });

/** The draft revision as an entity tag (research R10). */
export const etag = (revision: number): string => `"${revision}"`;

export async function createWorkflow(organizationId: string, name: string): Promise<WorkflowBody> {
  return (
    await request(`${base(organizationId)}/workflows`, WorkflowSchema, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  ).data;
}

export async function saveDraft(
  organizationId: string,
  workflowId: string,
  revision: number,
  definition: DagDefinition,
): Promise<SaveDraftResponse> {
  return (
    await request(
      `${base(organizationId)}/workflows/${workflowId}/draft`,
      SaveDraftResponseSchema,
      {
        method: 'PUT',
        headers: { 'If-Match': etag(revision) },
        body: JSON.stringify({ definition }),
      },
    )
  ).data;
}

export async function publishVersion(
  organizationId: string,
  workflowId: string,
  revision: number,
  note: string,
): Promise<VersionSummary> {
  return (
    await request(
      `${base(organizationId)}/workflows/${workflowId}/versions`,
      VersionSummarySchema,
      {
        method: 'POST',
        headers: { 'If-Match': etag(revision) },
        body: JSON.stringify(note.trim() === '' ? {} : { note: note.trim() }),
      },
    )
  ).data;
}

export async function activateVersion(
  organizationId: string,
  workflowId: string,
  versionNumber: number,
): Promise<VersionSummary> {
  return (
    await request(
      `${base(organizationId)}/workflows/${workflowId}/versions/${versionNumber}/activate`,
      VersionSummarySchema,
      { method: 'POST' },
    )
  ).data;
}

export async function copyVersionToDraft(
  organizationId: string,
  workflowId: string,
  versionNumber: number,
  revision: number,
): Promise<WorkflowBody> {
  return (
    await request(
      `${base(organizationId)}/workflows/${workflowId}/draft/from-version/${versionNumber}`,
      WorkflowSchema,
      { method: 'POST', headers: { 'If-Match': etag(revision) } },
    )
  ).data;
}
