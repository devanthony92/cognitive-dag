import type { LogLevel, LogMetadata, Logger as TemporalLogger } from '@temporalio/common';
import { createLogger, type Logger } from '@cognitive-dag/logger';

export function createWorkerLogger(level: string): Logger {
  return createLogger({ component: 'worker', level });
}

const PINO_LEVELS: Record<LogLevel, 'trace' | 'debug' | 'info' | 'warn' | 'error'> = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

/** Routes Temporal SDK logs (worker, workflow and activity loggers) to pino as JSON. */
export class PinoTemporalLogger implements TemporalLogger {
  constructor(private readonly logger: Logger) {}

  log(level: LogLevel, message: string, meta?: LogMetadata): void {
    this.logger[PINO_LEVELS[level]](meta ?? {}, message);
  }

  trace(message: string, meta?: LogMetadata): void {
    this.log('TRACE', message, meta);
  }

  debug(message: string, meta?: LogMetadata): void {
    this.log('DEBUG', message, meta);
  }

  info(message: string, meta?: LogMetadata): void {
    this.log('INFO', message, meta);
  }

  warn(message: string, meta?: LogMetadata): void {
    this.log('WARN', message, meta);
  }

  error(message: string, meta?: LogMetadata): void {
    this.log('ERROR', message, meta);
  }
}
