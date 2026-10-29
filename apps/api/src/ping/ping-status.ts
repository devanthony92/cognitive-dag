/** Minimal shape of a Temporal history event: only the attributes this decision reads. */
export interface HistoryEventLike {
  workflowTaskCompletedEventAttributes?: object | null;
}

/**
 * True once any workflow task has completed, i.e. a worker has made progress on the execution.
 * Counting events is not enough: a workflow task that timed out and was rescheduled also grows
 * the history without any worker having completed work.
 */
export function hasCompletedWorkflowTask(events: readonly HistoryEventLike[]): boolean {
  return events.some((event) => event.workflowTaskCompletedEventAttributes != null);
}
