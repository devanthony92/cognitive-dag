import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/index.js';

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return { logger: createLogger({ component: 'test', level: 'info' }, stream), lines };
}

describe('log redaction', () => {
  it.each(['password', 'token', 'secret', 'apiKey', 'credentials'])(
    'redacts %s at the top level and when nested',
    (field) => {
      const { logger, lines } = captureLogger();
      logger.info({ [field]: 'top-value', nested: { [field]: 'nested-value' } }, 'event');
      const line = lines[0]!;
      expect(line[field]).toBe('[REDACTED]');
      expect((line.nested as Record<string, unknown>)[field]).toBe('[REDACTED]');
      expect(JSON.stringify(line)).not.toContain('value');
    },
  );

  it('redacts authorization and cookie headers', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      { req: { headers: { authorization: 'Bearer abc', cookie: 'sid=abc', accept: '*/*' } } },
      'request',
    );
    const headers = (lines[0]!.req as { headers: Record<string, unknown> }).headers;
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers.cookie).toBe('[REDACTED]');
    expect(headers.accept).toBe('*/*');
  });

  it('writes structured JSON with level, time and component', () => {
    const { logger, lines } = captureLogger();
    logger.info({ correlationId: 'abc' }, 'hello');
    expect(lines[0]).toMatchObject({ level: 'info', component: 'test', msg: 'hello' });
    expect(typeof lines[0]!.time).toBe('string');
  });
});
