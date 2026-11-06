import { queryOptions } from '@tanstack/react-query';
import {
  CompilationListSchema,
  CompilationResultSchema,
  CompilationSchema,
  type Compilation,
} from '@cognitive-dag/contracts';
import { request } from '../../api/client';
import { pollDelay } from './poll';

const base = (organizationId: string) => `/api/v1/organizations/${organizationId}/compilations`;

export const compilationsKey = (organizationId: string, workflowId?: string) =>
  ['compilations', organizationId, workflowId ?? null] as const;
export const compilationKey = (organizationId: string, compilationId: string) =>
  ['compilation', organizationId, compilationId] as const;
export const compilationResultKey = (organizationId: string, compilationId: string) =>
  ['compilation-result', organizationId, compilationId] as const;

export const isFinalStatus = (compilation: Compilation): boolean =>
  compilation.status === 'succeeded' || compilation.status === 'failed';

/** There is a DAG to show: the result of a success or the last attempt of a failure (R9). */
export const hasContent = (compilation: Compilation): boolean =>
  compilation.status === 'succeeded' ||
  (compilation.status === 'failed' && compilation.hasFallback);

/** Recent compilations, newest first; of one workflow when `workflowId` is given. */
export const compilationsQuery = (organizationId: string, workflowId?: string) =>
  queryOptions({
    queryKey: compilationsKey(organizationId, workflowId),
    queryFn: async () =>
      (
        await request(
          workflowId === undefined
            ? base(organizationId)
            : `${base(organizationId)}?workflowId=${workflowId}`,
          CompilationListSchema,
        )
      ).data.items,
  });

/** A compilation, read again with a growing wait until it ends (1 s up to 5 s). */
export const compilationQuery = (organizationId: string, compilationId: string) =>
  queryOptions({
    queryKey: compilationKey(organizationId, compilationId),
    queryFn: async () =>
      (await request(`${base(organizationId)}/${compilationId}`, CompilationSchema)).data,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || isFinalStatus(data)) return false;
      return pollDelay(query.state.dataUpdateCount);
    },
  });

/** The DAG never changes once the compilation ended: it is fetched once. */
export const compilationResultQuery = (organizationId: string, compilationId: string) =>
  queryOptions({
    queryKey: compilationResultKey(organizationId, compilationId),
    queryFn: async () =>
      (await request(`${base(organizationId)}/${compilationId}/result`, CompilationResultSchema))
        .data,
    staleTime: Infinity,
    retry: false,
  });

export async function createCompilation(
  organizationId: string,
  intent: string,
  workflowId?: string,
): Promise<Compilation> {
  return (
    await request(base(organizationId), CompilationSchema, {
      method: 'POST',
      body: JSON.stringify(workflowId === undefined ? { intent } : { intent, workflowId }),
    })
  ).data;
}
