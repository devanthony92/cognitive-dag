import { queryOptions } from '@tanstack/react-query';
import { PublicFeaturesSchema } from '@cognitive-dag/contracts';
import { request } from '../api/client';

/**
 * The flags the API exposes. F8 removed the eight product flags, so the catalog is empty; the
 * query stays for the next feature that needs a flag (constitution, principle VIII).
 */
export const featuresQuery = queryOptions({
  queryKey: ['features'],
  queryFn: async () => (await request('/api/v1/features', PublicFeaturesSchema)).data,
});
