import { Inject, Injectable } from '@nestjs/common';
import {
  active,
  and,
  eq,
  sql,
  users,
  webhookTriggers,
  workflowActiveVersions,
  workflowVersions,
  type DatabaseClient,
  type Tx,
} from '@cognitive-dag/db';
import { webhookPath, type Webhook, type WebhookWithToken } from '@cognitive-dag/contracts';
import { ResourceNotFoundException } from '../common/errors/domain.exception';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DATABASE } from '../database/database.module';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { findActiveWorkflow } from '../workflows/workflow-queries';
import { generateWebhookToken, hashWebhookToken } from './webhook-token';

export interface WebhookActor {
  userId: string;
  organizationId: string;
  ip: string;
}

type TriggerRow = typeof webhookTriggers.$inferSelect;

/** Generating, regenerating and reading the state of a webhook (F7, US2). Never returns a stored token. */
@Injectable()
export class WebhookTokenService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: SecurityEventLogger,
  ) {}

  private apiOrigin(): string {
    return (this.config.API_PUBLIC_URL ?? `http://localhost:${this.config.API_PORT}`).replace(
      /\/$/,
      '',
    );
  }

  private urlBase(triggerId: string): string {
    return `${this.apiOrigin()}${webhookPath(triggerId)}`;
  }

  /** Status without the token; 404 while no token has been generated. */
  async get(actor: WebhookActor, workflowId: string): Promise<Webhook> {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        await findActiveWorkflow(tx, actor.organizationId, workflowId);
        const [row] = await tx
          .select()
          .from(webhookTriggers)
          .where(eq(webhookTriggers.workflowId, workflowId));
        if (!row) throw new ResourceNotFoundException();
        return this.toWebhook(tx, row);
      },
    );
  }

  /**
   * Creates the webhook with its first token, or replaces the token of the existing one. The old
   * token stops working in the same transaction (no grace period). The token is in this response
   * and nowhere else: only its SHA-256 is stored.
   */
  async regenerate(actor: WebhookActor, workflowId: string): Promise<WebhookWithToken> {
    const token = generateWebhookToken();
    const hash = hashWebhookToken(token);
    const webhook = await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        await findActiveWorkflow(tx, actor.organizationId, workflowId, { lock: true });
        const [existing] = await tx
          .select()
          .from(webhookTriggers)
          .where(eq(webhookTriggers.workflowId, workflowId));
        let row: TriggerRow | undefined;
        if (existing) {
          [row] = await tx
            .update(webhookTriggers)
            .set({
              tokenHash: hash,
              generation: sql`${webhookTriggers.generation} + 1`,
              generatedBy: actor.userId,
              generatedAt: new Date(),
            })
            .where(and(eq(webhookTriggers.id, existing.id)))
            .returning();
        } else {
          [row] = await tx
            .insert(webhookTriggers)
            .values({
              organizationId: actor.organizationId,
              workflowId,
              tokenHash: hash,
              createdBy: actor.userId,
              generatedBy: actor.userId,
            })
            .returning();
        }
        if (!row) throw new Error('webhook_triggers returned no row');
        return this.toWebhook(tx, row);
      },
    );
    this.events.emit({
      event: 'webhook.token.generated',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
      resourceId: workflowId,
    });
    return { ...webhook, url: `${webhook.urlBase}${token}` };
  }

  private async toWebhook(tx: Tx, row: TriggerRow): Promise<Webhook> {
    const [person] = await active.users(tx, eq(users.id, row.generatedBy));
    const [version] = await tx
      .select({ nodeTypes: workflowVersions.nodeTypes })
      .from(workflowActiveVersions)
      .innerJoin(workflowVersions, eq(workflowVersions.id, workflowActiveVersions.versionId))
      .where(eq(workflowActiveVersions.workflowId, row.workflowId));
    return {
      urlBase: this.urlBase(row.id),
      generation: row.generation,
      generatedAt: row.generatedAt.toISOString(),
      generatedBy: { id: row.generatedBy, name: person?.name ?? 'Usuario desconocido' },
      active: version?.nodeTypes.includes('trigger.webhook') ?? false,
    };
  }
}
