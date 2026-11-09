export interface FlagDefinition {
  /** Exposed to the web app through GET /api/v1/features. */
  public: boolean;
  owner: string;
  /** Issue that tracks removing the flag once the feature is stable (constitution, principle VIII). */
  removalIssue: string;
}

/** Every flag the API knows about. Flags absent here are never exposed. Empty since F8. */
export const FLAG_CATALOG = {} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAG_CATALOG;
