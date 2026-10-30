import { describe, expect, it, vi } from 'vitest';
import type { ClsService } from 'nestjs-cls';
import type { PinoLogger } from 'nestjs-pino';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';

const CORRELATION_ID = '0192f0a0-0000-7000-8000-0000000000cc';

describe('SecurityEventLogger', () => {
  const info = vi.fn();
  const logger = new SecurityEventLogger(
    { info } as unknown as PinoLogger,
    { getId: () => CORRELATION_ID } as unknown as ClsService,
  );

  it('logs a stable event name with outcome, origin, subjects and correlation id (FR-027)', () => {
    logger.emit({
      event: 'org.renamed',
      outcome: 'success',
      userId: 'u-1',
      organizationId: 'o-1',
      ip: '203.0.113.7',
    });

    expect(info).toHaveBeenCalledWith(
      {
        securityEvent: true,
        event: 'org.renamed',
        outcome: 'success',
        userId: 'u-1',
        organizationId: 'o-1',
        ip: '203.0.113.7',
        correlationId: CORRELATION_ID,
      },
      'org.renamed',
    );
  });

  it('drops any extra field a caller sneaks in, such as a password or a token', () => {
    info.mockClear();
    logger.emit({
      event: 'auth.login_failed',
      outcome: 'failure',
      ip: '203.0.113.7',
      password: 'secreto',
      token: 'abc',
    } as never);

    const [fields] = info.mock.calls[0] as [Record<string, unknown>];
    expect(JSON.stringify(fields)).not.toMatch(/secreto|abc/);
  });
});
