import type { WorkerConfig } from '../config/env.schema';

// Activity registry: activities receive their dependencies through this factory.
export function createActivities(_config: WorkerConfig) {
  return {};
}
