import { queryOptions } from '@tanstack/react-query';
import { ScheduleSchema } from '@cognitive-dag/contracts';
import { ApiProblemError, request } from '../../api/client';

const base = (organizationId: string, workflowId: string) =>
  `/api/v1/organizations/${organizationId}/workflows/${workflowId}`;

export const scheduleKey = (organizationId: string, workflowId: string) =>
  ['schedule', organizationId, workflowId] as const;

/** The schedule of the workflow; `null` while it has none (404). */
export const scheduleQuery = (organizationId: string, workflowId: string) =>
  queryOptions({
    queryKey: scheduleKey(organizationId, workflowId),
    queryFn: async () => {
      try {
        return (await request(`${base(organizationId, workflowId)}/schedule`, ScheduleSchema)).data;
      } catch (error) {
        if (error instanceof ApiProblemError && error.problem.status === 404) return null;
        throw error;
      }
    },
  });
