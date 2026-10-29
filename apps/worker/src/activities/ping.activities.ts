import { setTimeout as sleep } from 'node:timers/promises';
import { Context } from '@temporalio/activity';
import type { Logger } from '@cognitive-dag/logger';
import type { PingResult, PingWorkflowInput } from '@cognitive-dag/contracts';

export interface PingActivityOptions {
  workerId: string;
  /** Artificial delay in ms. Ignored when nodeEnv is "production". */
  delayMs: number;
  nodeEnv: string;
  logger: Logger;
}

export interface PingActivities {
  pong(input: PingWorkflowInput): Promise<PingResult>;
}

export function createPingActivities(options: PingActivityOptions): PingActivities {
  const delayMs = options.nodeEnv === 'production' ? 0 : options.delayMs;

  return {
    async pong(input) {
      const { attempt } = Context.current().info;
      const log = options.logger.child({ correlationId: input.correlationId });
      log.info({ attempt, workerId: options.workerId }, 'Ping activity started');
      if (delayMs > 0)
        await sleep(delayMs, undefined, { signal: Context.current().cancellationSignal });
      log.info({ attempt, workerId: options.workerId }, 'Ping activity finished');
      return { pong: input.message ?? 'pong', workerId: options.workerId, attempts: attempt };
    },
  };
}
