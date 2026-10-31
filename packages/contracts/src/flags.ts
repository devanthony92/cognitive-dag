import { z } from 'zod';

export const FEATURE_FLAGS = {
  pingEnabled: 'ping-enabled',
  identityEnabled: 'identity-enabled',
  dagEditorEnabled: 'dag-editor-enabled',
  executionEnabled: 'execution-enabled',
  resilienceEnabled: 'resilience-enabled',
} as const;

/** Flags exposed to the web app through GET /api/v1/features. */
export const PublicFeaturesSchema = z.record(z.string(), z.boolean());

export type PublicFeatures = z.infer<typeof PublicFeaturesSchema>;
