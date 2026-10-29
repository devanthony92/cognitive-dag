import { proxyActivities } from '@temporalio/workflow';
import type { PingResult, PingWorkflowInput } from '@cognitive-dag/contracts';
import type { PingActivities } from '../activities/ping.activities';

// Workflow code must stay deterministic: no I/O, clock, randomness or flag reads here.
// Only types are imported from other modules so the workflow bundle stays free of them.
const { pong } = proxyActivities<PingActivities>({
  startToCloseTimeout: '5 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export async function pingWorkflow(input: PingWorkflowInput): Promise<PingResult> {
  return pong(input);
}
