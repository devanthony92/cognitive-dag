import { queryOptions } from '@tanstack/react-query';
import { LlmDailyUsageSchema } from '@cognitive-dag/contracts';
import { request } from '../../api/client';

export const llmUsageKey = (organizationId: string) => ['llm-usage', organizationId] as const;

/** Tokens and cost of the organization on the current UTC day (F5). */
export const llmUsageQuery = (organizationId: string) =>
  queryOptions({
    queryKey: llmUsageKey(organizationId),
    queryFn: async () =>
      (
        await request(
          `/api/v1/organizations/${organizationId}/llm-usage/today`,
          LlmDailyUsageSchema,
        )
      ).data,
  });
