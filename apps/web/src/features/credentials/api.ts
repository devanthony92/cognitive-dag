import { queryOptions } from '@tanstack/react-query';
import {
  CredentialListSchema,
  CredentialSchema,
  type CreateCredentialRequest,
} from '@cognitive-dag/contracts';
import { request } from '../../api/client';
import { NoBodySchema } from '../session/session';

const base = (organizationId: string) => `/api/v1/organizations/${organizationId}/credentials`;

export const credentialsKey = (organizationId: string) => ['credentials', organizationId] as const;

/** Metadata of the live credentials; the secret is never part of an answer. */
export const credentialsQuery = (organizationId: string) =>
  queryOptions({
    queryKey: credentialsKey(organizationId),
    queryFn: async () => (await request(base(organizationId), CredentialListSchema)).data.items,
    retry: false,
  });

export async function createCredential(organizationId: string, input: CreateCredentialRequest) {
  return (
    await request(base(organizationId), CredentialSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  ).data;
}

export async function rotateCredential(
  organizationId: string,
  credentialId: string,
  secret: string,
) {
  return (
    await request(`${base(organizationId)}/${credentialId}`, CredentialSchema, {
      method: 'PUT',
      body: JSON.stringify({ secret }),
    })
  ).data;
}

export async function archiveCredential(organizationId: string, credentialId: string) {
  await request(`${base(organizationId)}/${credentialId}`, NoBodySchema, { method: 'DELETE' });
}
