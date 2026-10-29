interface PgErrorLike {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/** Drizzle wraps the driver error in `cause`; the SQLSTATE lives on the innermost one. */
function pgError(error: unknown): PgErrorLike | undefined {
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    const candidate = current as PgErrorLike;
    if (typeof candidate.code === 'string') return candidate;
    current = candidate.cause;
  }
  return undefined;
}

const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = pgError(error);
  return pg?.code === UNIQUE_VIOLATION && pg.constraint === constraint;
}
