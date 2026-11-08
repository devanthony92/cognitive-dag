import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { resolveCorrelationId } from '@cognitive-dag/contracts';

/** Stable event names (FR-026, FR-028). Filter logs by `event`. */
export const SECURITY_EVENTS = [
  'user.registered',
  'user.email_verified',
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.logout',
  'auth.rate_limited',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'auth.password_changed',
  'org.created',
  'org.renamed',
  'invitation.sent',
  'invitation.accepted',
  'invitation.revoked',
  'membership.role_changed',
  'membership.removed',
  'workflow.created',
  'workflow.published',
  'workflow.version_activated',
  'workflow.archived',
  'run.started',
  'run.cancelled',
  'run.rerun',
] as const;

/** F7 events (research R15). Stable names; none carries a token, a secret, a message or a comment. */
export const TRIGGER_SECURITY_EVENTS = [
  'webhook.token.generated',
  'webhook.accepted',
  'webhook.rejected',
  'approval.decided',
  'credential.created',
  'credential.rotated',
  'credential.archived',
  'http_host.added',
  'http_host.removed',
] as const;

export type SecurityEventType =
  (typeof SECURITY_EVENTS)[number] | (typeof TRIGGER_SECURITY_EVENTS)[number];

export interface SecurityEvent {
  event: SecurityEventType;
  outcome: 'success' | 'failure' | 'blocked';
  userId?: string;
  organizationId?: string;
  ip?: string;
  /** Node a rerun started from (`run.rerun`). */
  nodeId?: string;
  /** Why a webhook was rejected (`webhook.rejected`): a fixed vocabulary, never the offending value. */
  reason?: 'token' | 'timestamp' | 'event_id' | 'rate_limit' | 'not_active' | 'body';
  /** Id of the thing the event is about (workflow, trigger, credential, approval): never a secret. */
  resourceId?: string;
}

/**
 * Single emitter of security events as structured logs (research R15, FR-026/027). The type
 * admits no free-form fields, so passwords, tokens and session ids cannot be attached to an event.
 */
@Injectable()
export class SecurityEventLogger {
  constructor(
    @InjectPinoLogger('security-events') private readonly logger: PinoLogger,
    private readonly cls: ClsService,
  ) {}

  emit(event: SecurityEvent): void {
    this.logger.info(
      {
        securityEvent: true,
        event: event.event,
        outcome: event.outcome,
        userId: event.userId,
        organizationId: event.organizationId,
        ip: event.ip,
        nodeId: event.nodeId,
        reason: event.reason,
        resourceId: event.resourceId,
        correlationId: resolveCorrelationId(this.cls.getId()),
      },
      event.event,
    );
  }
}
