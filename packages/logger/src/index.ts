import { pino, stdTimeFunctions } from 'pino';
import type { DestinationStream, Logger, LoggerOptions } from 'pino';

/** Keys whose values are never shown: in logs and in the run content the API returns. */
export const SENSITIVE_KEYS = ['password', 'token', 'secret', 'apiKey', 'credentials'];

/** Paths redacted in every log line (constitution, principle I; OWASP A09). */
export const REDACT_PATHS = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export interface LoggerConfig {
  component: string;
  level: string;
}

export function loggerOptions({ component, level }: LoggerConfig): LoggerOptions {
  return {
    level,
    base: { component },
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
}

export function createLogger(config: LoggerConfig, destination?: DestinationStream): Logger {
  return destination ? pino(loggerOptions(config), destination) : pino(loggerOptions(config));
}

export type { Logger } from 'pino';
