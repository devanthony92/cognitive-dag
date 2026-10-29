import { describe, expect, it } from 'vitest';
import { hasCompletedWorkflowTask, type HistoryEventLike } from '../../src/ping/ping-status';

type Event = HistoryEventLike;

const started: Event = {};
const wftScheduled: Event = {};
const wftStarted: Event = {};
const wftTimedOut: Event = {};
const wftCompleted: Event = { workflowTaskCompletedEventAttributes: {} };
const activityScheduled: Event = {};

describe('hasCompletedWorkflowTask', () => {
  it('is false before any worker picks up the first workflow task', () => {
    expect(hasCompletedWorkflowTask([started, wftScheduled])).toBe(false);
  });

  it('is false when the first workflow task timed out and was rescheduled', () => {
    expect(
      hasCompletedWorkflowTask([started, wftScheduled, wftStarted, wftTimedOut, wftScheduled]),
    ).toBe(false);
  });

  it('is true once a workflow task completed', () => {
    expect(
      hasCompletedWorkflowTask([
        started,
        wftScheduled,
        wftStarted,
        wftCompleted,
        activityScheduled,
      ]),
    ).toBe(true);
  });
});
