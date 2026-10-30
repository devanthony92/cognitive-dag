import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_LIMITS, type DagLimits } from '@cognitive-dag/dag-schema';
import { eq, organizationLimits, type DatabaseClient, type Tx } from '@cognitive-dag/db';
import type { LimitsBody } from '@cognitive-dag/contracts';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DATABASE } from '../database/database.module';

/**
 * The limits a definition is validated against: the organization's own, or the platform
 * defaults, never above the ceilings of the server configuration (FR-020, FR-021, R12).
 */
@Injectable()
export class LimitsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Reads inside the caller's transaction, so a publication sees one consistent set of limits. */
  async effectiveIn(tx: Tx, organizationId: string): Promise<LimitsBody> {
    const [row] = await tx
      .select()
      .from(organizationLimits)
      .where(eq(organizationLimits.organizationId, organizationId));
    const wanted: DagLimits = row
      ? {
          maxNodes: row.maxNodes,
          maxEdges: row.maxEdges,
          maxDefinitionBytes: row.maxDefinitionBytes,
        }
      : DEFAULT_LIMITS;
    return {
      maxNodes: Math.min(wanted.maxNodes, this.config.DAG_MAX_NODES_CEILING),
      maxEdges: Math.min(wanted.maxEdges, this.config.DAG_MAX_EDGES_CEILING),
      maxDefinitionBytes: Math.min(
        wanted.maxDefinitionBytes,
        this.config.DAG_MAX_DEFINITION_BYTES_CEILING,
      ),
      source: row ? 'organization' : 'default',
    };
  }

  effective(userId: string, organizationId: string): Promise<LimitsBody> {
    return this.database.withContext({ userId, organizationId }, (tx) =>
      this.effectiveIn(tx, organizationId),
    );
  }
}

export function toDagLimits({ maxNodes, maxEdges, maxDefinitionBytes }: LimitsBody): DagLimits {
  return { maxNodes, maxEdges, maxDefinitionBytes };
}
