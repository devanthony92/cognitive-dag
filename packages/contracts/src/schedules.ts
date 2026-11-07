import { z } from 'zod';

export const ScheduleDesiredStateSchema = z.enum(['scheduled', 'removed']);
export type ScheduleDesiredState = z.infer<typeof ScheduleDesiredStateSchema>;

export const ScheduleSyncStatusSchema = z.enum(['pending', 'synced', 'failed']);
export type ScheduleSyncStatus = z.infer<typeof ScheduleSyncStatusSchema>;

/** Upcoming firings the API shows at most (F7, research R6). */
export const SCHEDULE_NEXT_RUNS_MAX = 5;

/** Id of the Temporal Schedule of a workflow (F7, research R6). */
export const scheduleIdFor = (workflowId: string): string => `sched-${workflowId}`;

/** Id of the `fireSchedule` workflow of one firing. */
export const FIRE_SCHEDULE_WORKFLOW_NAME = 'fireSchedule';

/** The programmed schedule of a workflow: what is wanted, whether Temporal has it, what comes next. */
export const ScheduleSchema = z.object({
  desiredState: ScheduleDesiredStateSchema,
  syncStatus: ScheduleSyncStatusSchema,
  cron: z.string().min(1),
  timezone: z.string().min(1),
  versionNumber: z.int().min(1),
  lastErrorCode: z.string().nullable(),
  nextRuns: z.array(z.iso.datetime()).max(SCHEDULE_NEXT_RUNS_MAX),
});
export type Schedule = z.infer<typeof ScheduleSchema>;
