import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  llmCalls,
  llmUsageDaily,
  sql,
  type DatabaseClient,
  type Tx,
} from '@cognitive-dag/db';
import type { LlmDailyUsage, LlmUsage } from '@cognitive-dag/contracts';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DATABASE } from '../database/database.module';

/** Usage of a run: its total and the sum per node. Both are absent where there were no calls. */
export interface RunLlmUsage {
  total: LlmUsage | null;
  byNode: Map<string, LlmUsage>;
}

/** The current UTC day as `YYYY-MM-DD`. */
export const utcDay = (now = new Date()): string => now.toISOString().slice(0, 10);

/** Sums the calls of a run per node (research R12); runs inside the caller's tenant context. */
export async function loadRunLlmUsage(tx: Tx, runId: string): Promise<RunLlmUsage> {
  const rows = await tx
    .select({
      nodeId: llmCalls.nodeId,
      calls: sql<number>`count(*)::int`,
      models: sql<number>`count(DISTINCT ${llmCalls.model})::int`,
      model: sql<string>`min(${llmCalls.model})`,
      inputTokens: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)::int`,
      costMicroUsd: sql<number>`coalesce(sum(${llmCalls.costMicroUsd}), 0)::float8`,
      repairs: sql<number>`coalesce(sum(${llmCalls.repairs}), 0)::int`,
    })
    .from(llmCalls)
    .where(eq(llmCalls.runId, runId))
    .groupBy(llmCalls.nodeId);

  const byNode = new Map<string, LlmUsage>();
  const total = { calls: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, repairs: 0 };
  for (const row of rows) {
    // The rows of a run always have a node; only a compilation's calls (F6) have none.
    if (row.nodeId === null) continue;
    byNode.set(row.nodeId, {
      calls: row.calls,
      model: row.models === 1 ? row.model : null,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costMicroUsd: Number(row.costMicroUsd),
      repairs: row.repairs,
    });
    total.calls += row.calls;
    total.inputTokens += row.inputTokens;
    total.outputTokens += row.outputTokens;
    total.costMicroUsd += Number(row.costMicroUsd);
    total.repairs += row.repairs;
  }
  return { total: total.calls > 0 ? total : null, byNode };
}

@Injectable()
export class LlmUsageService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Usage of the organization on the current UTC day; zeros when there is no counter yet. */
  async today(userId: string, organizationId: string): Promise<LlmDailyUsage> {
    const date = utcDay();
    const [row] = await this.database.withContext({ userId, organizationId }, (tx) =>
      tx
        .select()
        .from(llmUsageDaily)
        .where(
          and(eq(llmUsageDaily.organizationId, organizationId), eq(llmUsageDaily.usageDate, date)),
        ),
    );
    return {
      date,
      tokensUsed: row?.tokensUsed ?? 0,
      tokensLimit: this.config.LLM_MAX_TOKENS_PER_ORG_DAY,
      costMicroUsd: row?.costMicroUsd ?? 0,
    };
  }
}
