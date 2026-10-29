export interface FlagDefinition {
  /** Exposed to the web app through GET /api/v1/features. */
  public: boolean;
  owner: string;
  /** Issue that tracks removing the flag once the feature is stable (constitution, principle VIII). */
  removalIssue: string;
}

/** Every flag the API knows about. Flags absent here are never exposed. */
export const FLAG_CATALOG = {
  'ping-enabled': {
    public: true,
    owner: 'devanthony92',
    removalIssue: 'https://github.com/devanthony92/cognitive-dag/issues/2',
  },
  'identity-enabled': {
    public: true,
    owner: 'devanthony92',
    removalIssue: 'https://github.com/devanthony92/cognitive-dag/issues/14',
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAG_CATALOG;
