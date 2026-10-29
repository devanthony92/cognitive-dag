import type { ArgumentsHost } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { ProblemDetailsFilter } from '../../src/common/errors/problem-details.filter';

const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';

function run(exception: unknown) {
  const error = vi.fn();
  const json = vi.fn();
  const response = { status: vi.fn(), type: vi.fn(), json };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  const filter = new ProblemDetailsFilter(
    { getId: () => CORRELATION_ID } as unknown as ClsService,
    { error } as unknown as PinoLogger,
  );
  filter.catch(exception, {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost);
  return { error, body: json.mock.calls[0]?.[0] as Record<string, unknown> };
}

describe('ProblemDetailsFilter logging', () => {
  it('logs the full error with the correlation id on 5xx and keeps the response generic', () => {
    const failure = new Error('connection to "secret_table" refused');
    const { error, body } = run(failure);

    expect(error).toHaveBeenCalledWith(
      { err: failure, correlationId: CORRELATION_ID },
      expect.any(String),
    );
    expect(body.status).toBe(500);
    expect(body.correlationId).toBe(CORRELATION_ID);
    expect(JSON.stringify(body)).not.toContain('secret_table');
  });

  it('does not log client errors as server errors', () => {
    const { error } = run(Object.assign(new Error('too big'), { type: 'entity.too.large' }));
    expect(error).not.toHaveBeenCalled();
  });
});
