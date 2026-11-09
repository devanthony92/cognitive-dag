import { Writable } from 'node:stream';
import { createLogger, type Logger } from '@cognitive-dag/logger';

export interface CapturedLogger {
  logger: Logger;
  /** Every line written so far, parsed. */
  lines(): Array<Record<string, unknown>>;
  /** Lines with the given stable `event` name. */
  events(event: string): Array<Record<string, unknown>>;
  /** The raw text, to check that no content leaked. */
  raw(): string;
}

/** A logger that keeps its output, so a test can assert on the security events it emits. */
export function captureLogger(): CapturedLogger {
  const chunks: string[] = [];
  const sink = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      chunks.push(chunk.toString());
      done();
    },
  });
  const lines = () =>
    chunks
      .join('')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return {
    logger: createLogger({ component: 'worker-test', level: 'trace' }, sink),
    lines,
    events: (event) => lines().filter((line) => line.event === event),
    raw: () => chunks.join(''),
  };
}
