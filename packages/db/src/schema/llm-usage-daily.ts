import { sql } from 'drizzle-orm';
import { bigint, check, date, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

/**
 * Tokens of an organization on a UTC day (F5, research R4). Reserved before each call and adjusted
 * after it, so it includes the reservations in progress. The daily limit is configuration, not a
 * column: the reservation applies it in `UPDATE ... WHERE tokens_used + $e <= $limit`.
 */
export const llmUsageDaily = pgTable(
  'llm_usage_daily',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** UTC day of the reservation. */
    usageDate: date('usage_date', { mode: 'string' }).notNull(),
    tokensUsed: bigint('tokens_used', { mode: 'number' }).notNull().default(0),
    /** Estimated, in micro-USD. */
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.usageDate] }),
    check('llm_usage_daily_tokens_non_negative', sql`${table.tokensUsed} >= 0`),
    check('llm_usage_daily_cost_non_negative', sql`${table.costMicroUsd} >= 0`),
  ],
);
