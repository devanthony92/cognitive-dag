import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  ApprovalCountSchema,
  ApprovalDetailSchema,
  ApprovalListSchema,
  ApprovalSchema,
  type DecideApprovalRequest,
} from '@cognitive-dag/contracts';
import { request } from '../../api/client';

const base = (organizationId: string) => `/api/v1/organizations/${organizationId}/approvals`;

/** How often the counter of the top bar looks again (research: polling, no SSE). */
export const APPROVAL_COUNT_REFRESH_MS = 30_000;

export const APPROVALS_PAGE_SIZE = 20;

export type ApprovalTab = 'pending' | 'resolved';

export const approvalCountKey = (organizationId: string) =>
  ['approval-count', organizationId] as const;
export const approvalsKey = (organizationId: string, tab: ApprovalTab) =>
  ['approvals', organizationId, tab] as const;
export const approvalKey = (organizationId: string, approvalId: string) =>
  ['approval', organizationId, approvalId] as const;

export const approvalCountQuery = (organizationId: string) =>
  queryOptions({
    queryKey: approvalCountKey(organizationId),
    queryFn: async () => (await request(`${base(organizationId)}/count`, ApprovalCountSchema)).data,
    refetchInterval: APPROVAL_COUNT_REFRESH_MS,
  });

export const approvalsQuery = (organizationId: string, tab: ApprovalTab) =>
  infiniteQueryOptions({
    queryKey: approvalsKey(organizationId, tab),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ status: tab, limit: String(APPROVALS_PAGE_SIZE) });
      if (pageParam !== undefined) params.set('cursor', pageParam);
      return (await request(`${base(organizationId)}?${params.toString()}`, ApprovalListSchema))
        .data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const approvalQuery = (organizationId: string, approvalId: string) =>
  queryOptions({
    queryKey: approvalKey(organizationId, approvalId),
    queryFn: async () =>
      (await request(`${base(organizationId)}/${approvalId}`, ApprovalDetailSchema)).data,
    retry: false,
  });

export async function decideApproval(
  organizationId: string,
  approvalId: string,
  decision: DecideApprovalRequest,
) {
  return (
    await request(`${base(organizationId)}/${approvalId}/decision`, ApprovalSchema, {
      method: 'POST',
      body: JSON.stringify(decision),
    })
  ).data;
}
