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
] as const;

export type SecurityEventType = (typeof SECURITY_EVENTS)[number];

export interface SecurityEvent {
  event: SecurityEventType;
  outcome: 'success' | 'failure' | 'blocked';
  userId?: string;
  organizationId?: string;
  ip?: string;
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
        correlationId: resolveCorrelationId(this.cls.getId()),
      },
      event.event,
    );
  }
}
