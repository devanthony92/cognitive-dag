import { queryOptions } from '@tanstack/react-query';
import { FEATURE_FLAGS, PublicFeaturesSchema } from '@cognitive-dag/contracts';
import { request } from '../api/client';

/** Same key and data as the ping panel's query, so both share one request. */
export const featuresQuery = queryOptions({
  queryKey: ['features'],
  queryFn: async () => (await request('/api/v1/features', PublicFeaturesSchema)).data,
});

export function isIdentityEnabled(features: Record<string, boolean> | undefined): boolean {
  return features?.[FEATURE_FLAGS.identityEnabled] === true;
}

export function isDagEditorEnabled(features: Record<string, boolean> | undefined): boolean {
  return features?.[FEATURE_FLAGS.dagEditorEnabled] === true;
}

export function isExecutionEnabled(features: Record<string, boolean> | undefined): boolean {
  return features?.[FEATURE_FLAGS.executionEnabled] === true;
}
