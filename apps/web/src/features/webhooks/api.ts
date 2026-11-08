import { queryOptions } from '@tanstack/react-query';
import { WebhookSchema, WebhookWithTokenSchema } from '@cognitive-dag/contracts';
import { ApiProblemError, request } from '../../api/client';

const base = (organizationId: string, workflowId: string) =>
  `/api/v1/organizations/${organizationId}/workflows/${workflowId}`;

export const webhookKey = (organizationId: string, workflowId: string) =>
  ['webhook', organizationId, workflowId] as const;

/** State of the webhook; `null` while no token was ever generated (the API answers 404). */
export const webhookQuery = (organizationId: string, workflowId: string) =>
  queryOptions({
    queryKey: webhookKey(organizationId, workflowId),
    queryFn: async () => {
      try {
        return (await request(`${base(organizationId, workflowId)}/webhook`, WebhookSchema)).data;
      } catch (error) {
        if (error instanceof ApiProblemError && error.problem.status === 404) return null;
        throw error;
      }
    },
  });

/** Generates the token the first time and regenerates it afterwards; the URL is in this answer only. */
export async function regenerateWebhookToken(organizationId: string, workflowId: string) {
  return (
    await request(`${base(organizationId, workflowId)}/webhook/token`, WebhookWithTokenSchema, {
      method: 'POST',
    })
  ).data;
}
