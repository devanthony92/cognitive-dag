import { z } from 'zod';

/**
 * Product flags exposed to the web app. F8 removed the eight that existed (each feature is simply
 * on); the module stays for the next incomplete feature that must reach `main` (principle VIII).
 */
export const FEATURE_FLAGS = {} as const;

/** Flags exposed to the web app through GET /api/v1/features. */
export const PublicFeaturesSchema = z.record(z.string(), z.boolean());

export type PublicFeatures = z.infer<typeof PublicFeaturesSchema>;
