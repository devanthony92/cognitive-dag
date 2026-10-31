import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  RunDetailSchema,
  RunListSchema,
  RunSchema,
  StepIoSchema,
  type Run,
} from '@cognitive-dag/contracts';
import { request } from '../../api/client';

const base = (organizationId: string) => `/api/v1/organizations/${organizationId}`;

/** Rows per page of the run list. */
export const RUNS_PAGE_SIZE = 20;

export const runsKey = (organizationId: string, workflowId: string) =>
  ['runs', organizationId, workflowId] as const;
export const runKey = (organizationId: string, runId: string) =>
  ['run', organizationId, runId] as const;

export const runsQuery = (organizationId: string, workflowId: string) =>
  infiniteQueryOptions({
    queryKey: runsKey(organizationId, workflowId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(RUNS_PAGE_SIZE) });
      if (pageParam !== undefined) params.set('cursor', pageParam);
      return (
        await request(
          `${base(organizationId)}/workflows/${workflowId}/runs?${params.toString()}`,
          RunListSchema,
        )
      ).data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const runQuery = (organizationId: string, runId: string) =>
  queryOptions({
    queryKey: runKey(organizationId, runId),
    queryFn: async () =>
      (await request(`${base(organizationId)}/runs/${runId}`, RunDetailSchema)).data,
  });

/** Read from Temporal on demand; the step status is part of the key so a change refetches it. */
export const stepIoQuery = (
  organizationId: string,
  runId: string,
  nodeId: string,
  status: string,
) =>
  queryOptions({
    queryKey: ['run-step-io', organizationId, runId, nodeId, status] as const,
    queryFn: async () =>
      (
        await request(
          `${base(organizationId)}/runs/${runId}/steps/${encodeURIComponent(nodeId)}/io`,
          StepIoSchema,
        )
      ).data,
    retry: false,
    staleTime: Infinity,
  });

export const runEventsUrl = (organizationId: string, runId: string): string =>
  `${import.meta.env.VITE_API_URL as string}${base(organizationId)}/runs/${runId}/events`;

export async function startRun(
  organizationId: string,
  workflowId: string,
  input: Record<string, unknown>,
): Promise<Run> {
  return (
    await request(`${base(organizationId)}/workflows/${workflowId}/runs`, RunSchema, {
      method: 'POST',
      body: JSON.stringify({ input }),
    })
  ).data;
}

export async function cancelRun(organizationId: string, runId: string): Promise<Run> {
  return (
    await request(`${base(organizationId)}/runs/${runId}/cancel`, RunSchema, { method: 'POST' })
  ).data;
}

export async function rerunRun(organizationId: string, runId: string): Promise<Run> {
  return (
    await request(`${base(organizationId)}/runs/${runId}/rerun`, RunSchema, { method: 'POST' })
  ).data;
}
