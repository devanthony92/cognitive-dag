import { z } from 'zod';
import { PersonRefSchema } from './primitives.js';
import { RunStatusSchema } from './runs.js';

/** Prefix of the webhook token: lets secret scanners recognize it (F7, research R2). */
export const WEBHOOK_TOKEN_PREFIX = 'cdw_';

/** `cdw_` + base64url of 32 random bytes. */
export const WEBHOOK_TOKEN_PATTERN = /^cdw_[A-Za-z0-9_-]{43}$/;

/** `X-Event-Id`: 1-128 characters (research R3). */
export const WEBHOOK_EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Largest body the webhook takes by default (`WEBHOOK_MAX_BODY_BYTES`, research R3). */
export const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

/** Half-width of the accepted `X-Event-Timestamp` window, in seconds (research R3). */
export const DEFAULT_WEBHOOK_TIMESTAMP_WINDOW_SECONDS = 300;

/** Public route of a webhook, without the token (F7, research R2). */
export const webhookPath = (triggerId: string): string => `/api/v1/hooks/${triggerId}/`;

/** `202` for a new event and `200` for a repeated `X-Event-Id`, with the run of the first one. */
export const WebhookAcceptedSchema = z.object({
  runId: z.uuid(),
  status: RunStatusSchema,
  duplicate: z.boolean(),
});
export type WebhookAccepted = z.infer<typeof WebhookAcceptedSchema>;

/** State of the webhook of a workflow. Never carries the token. */
export const WebhookSchema = z.object({
  /** Route without the token, e.g. `https://host/api/v1/hooks/{triggerId}/`. */
  urlBase: z.string().min(1),
  generation: z.int().min(1),
  generatedAt: z.iso.datetime(),
  generatedBy: PersonRefSchema,
  /** The workflow has an active version with `trigger.webhook`. */
  active: z.boolean(),
});
export type Webhook = z.infer<typeof WebhookSchema>;

/** The one response that carries the token: the full URL, shown once. */
export const WebhookWithTokenSchema = WebhookSchema.extend({ url: z.string().min(1) });
export type WebhookWithToken = z.infer<typeof WebhookWithTokenSchema>;
