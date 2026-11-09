import { ScheduleNotFoundError } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scheduleIdFor, type Schedule } from '@cognitive-dag/contracts';
import { eq, workflowSchedules } from '@cognitive-dag/db';
import { authHeaders } from './identity-helpers';
import {
  api,
  closeTriggersEnv,
  publishedWorkflow,
  scheduleDefinition,
  setupTriggersEnv,
  webhookDefinition,
  type TriggersEnv,
  problemOf,
} from './triggers-helpers';
import {
  createWorkflow,
  publish,
  saveDraft,
  setLimitsAsOperator,
  workflowsPath,
} from './workflows-helpers';

let env: TriggersEnv;
const created: string[] = [];

beforeAll(async () => {
  env = await setupTriggersEnv({}, { withWorker: false });
}, 120_000);

afterAll(async () => {
  // Schedules left in Temporal would keep firing after the tests.
  for (const workflowId of created) {
    await env.temporal.schedule
      .getHandle(scheduleIdFor(workflowId))
      .delete()
      .catch(() => undefined);
  }
  await closeTriggersEnv(env);
});

const schedulePath = (workflowId: string) =>
  `${workflowsPath(env.organization.id)}/${workflowId}/schedule`;

const getSchedule = async (workflowId: string, session = env.owner): Promise<Schedule> =>
  (await api(env).get(schedulePath(workflowId)).set(authHeaders(session)).expect(200))
    .body as Schedule;

const scheduled = async (cron?: string, timezone?: string) => {
  const workflow = await publishedWorkflow(env, scheduleDefinition(cron, timezone));
  created.push(workflow.id);
  return workflow;
};

const existsInTemporal = async (workflowId: string): Promise<boolean> => {
  try {
    await env.temporal.schedule.getHandle(scheduleIdFor(workflowId)).describe();
    return true;
  } catch (error) {
    if (error instanceof ScheduleNotFoundError) return false;
    throw error;
  }
};

describe('schedule of the active version', () => {
  it('activating a version asks for the schedule and the reconciler creates it', async () => {
    const workflow = await scheduled('*/5 * * * *', 'America/Bogota');
    const before = await getSchedule(workflow.id);
    expect(before).toMatchObject({
      desiredState: 'scheduled',
      syncStatus: 'pending',
      cron: '*/5 * * * *',
      timezone: 'America/Bogota',
      versionNumber: 1,
      nextRuns: [],
    });
    expect(await existsInTemporal(workflow.id)).toBe(false);

    await env.reconcile();
    const after = await getSchedule(workflow.id);
    expect(after.syncStatus).toBe('synced');
    expect(after.nextRuns.length).toBeGreaterThan(0);
    expect(after.nextRuns.length).toBeLessThanOrEqual(5);
    expect(await existsInTemporal(workflow.id)).toBe(true);
  });

  it('changing the active version updates the schedule; one without it removes it', async () => {
    const workflow = await scheduled('*/5 * * * *');
    await env.reconcile();

    const draft = await saveDraft(
      env,
      env.owner,
      workflow.id,
      2,
      scheduleDefinition('0 9 * * *', 'UTC'),
    ).expect(200);
    await publish(
      env,
      env.owner,
      workflow.id,
      (draft.body as { revision: number }).revision,
    ).expect(201);
    expect(await getSchedule(workflow.id)).toMatchObject({
      cron: '0 9 * * *',
      versionNumber: 2,
      syncStatus: 'pending',
    });
    await env.reconcile();
    // Temporal turns the cron into calendars; its next firing proves it has the new one.
    const [next] = (await getSchedule(workflow.id)).nextRuns;
    expect(new Date(next!).getUTCHours()).toBe(9);
    expect(new Date(next!).getUTCMinutes()).toBe(0);

    // Back to version 1 (also a schedule, another cron), then a version without the trigger.
    await api(env)
      .post(`${workflowsPath(env.organization.id)}/${workflow.id}/versions/1/activate`)
      .set(authHeaders(env.owner))
      .expect(200);
    expect((await getSchedule(workflow.id)).cron).toBe('*/5 * * * *');

    const plain = await saveDraft(env, env.owner, workflow.id, 3, webhookDefinition()).expect(200);
    await publish(
      env,
      env.owner,
      workflow.id,
      (plain.body as { revision: number }).revision,
    ).expect(201);
    expect((await getSchedule(workflow.id)).desiredState).toBe('removed');
    await env.reconcile();
    expect(await existsInTemporal(workflow.id)).toBe(false);
    expect((await getSchedule(workflow.id)).syncStatus).toBe('synced');
  });

  it('a new active version restarts the attempts of a schedule the reconciler gave up on (F8, cap of 20)', async () => {
    const workflow = await scheduled('*/10 * * * *');
    const rowOf = () =>
      env.database.withContext({ organizationId: env.organization.id }, async (tx) => {
        const [row] = await tx
          .select({
            syncStatus: workflowSchedules.syncStatus,
            syncAttempts: workflowSchedules.syncAttempts,
            lastErrorCode: workflowSchedules.lastErrorCode,
          })
          .from(workflowSchedules)
          .where(eq(workflowSchedules.workflowId, workflow.id));
        return row!;
      });
    await env.database.withContext({ organizationId: env.organization.id }, (tx) =>
      tx
        .update(workflowSchedules)
        .set({ syncStatus: 'failed', syncAttempts: 20, lastErrorCode: 'SCHEDULE_SYNC_FAILED' })
        .where(eq(workflowSchedules.workflowId, workflow.id)),
    );
    expect(await rowOf()).toMatchObject({ syncStatus: 'failed', syncAttempts: 20 });

    // Same cron, new version: the row follows the version and starts over.
    const draft = await saveDraft(
      env,
      env.owner,
      workflow.id,
      2,
      // Same cron, another definition (an identical one would not publish).
      (() => {
        const same = scheduleDefinition('*/10 * * * *');
        return { ...same, nodes: [same.nodes[0]!, { ...same.nodes[1]!, label: 'Otro paso' }] };
      })(),
    ).expect(200);
    await publish(
      env,
      env.owner,
      workflow.id,
      (draft.body as { revision: number }).revision,
    ).expect(201);
    expect(await rowOf()).toEqual({ syncStatus: 'pending', syncAttempts: 0, lastErrorCode: null });
  });

  it('archiving the workflow removes its schedule', async () => {
    const workflow = await scheduled();
    await env.reconcile();
    expect(await existsInTemporal(workflow.id)).toBe(true);
    await api(env)
      .delete(`${workflowsPath(env.organization.id)}/${workflow.id}`)
      .set(authHeaders(env.owner))
      .expect(204);
    await env.reconcile();
    expect(await existsInTemporal(workflow.id)).toBe(false);
  });

  it('keeps the activation when Temporal has not applied the schedule: the row waits as pending', async () => {
    // No reconciler pass runs here: Temporal is "unreachable" for this schedule.
    const workflow = await scheduled();
    expect(await existsInTemporal(workflow.id)).toBe(false);
    const state = await getSchedule(workflow.id);
    expect(state.syncStatus).toBe('pending');
    const versions = await api(env)
      .get(`${workflowsPath(env.organization.id)}/${workflow.id}/versions`)
      .set(authHeaders(env.owner))
      .expect(200);
    expect((versions.body as { number: number; active: boolean }[]).some((v) => v.active)).toBe(
      true,
    );
  });

  it('refuses the schedule over the limit with SCHEDULE_LIMIT_REACHED, and allows it again after removing one', async () => {
    const taken = await scheduled();
    await setLimitsAsOperator(env.organization.id, {
      maxNodes: 50,
      maxEdges: 100,
      maxDefinitionBytes: 262_144,
      maxActiveSchedules: 1,
    });
    try {
      // Other tests of this file left schedules: remove them so only `taken` counts.
      for (const id of created.filter((workflowId) => workflowId !== taken.id)) {
        await api(env)
          .delete(`${workflowsPath(env.organization.id)}/${id}`)
          .set(authHeaders(env.owner))
          .expect((res) => expect([204, 404]).toContain(res.status));
      }
      const second = await createWorkflow(env);
      created.push(second.id);
      const draft = await saveDraft(env, env.owner, second.id, 1, scheduleDefinition()).expect(200);
      const refused = await publish(
        env,
        env.owner,
        second.id,
        (draft.body as { revision: number }).revision,
      ).expect(409);
      expect(problemOf(refused).code).toBe('SCHEDULE_LIMIT_REACHED');

      await api(env)
        .delete(`${workflowsPath(env.organization.id)}/${taken.id}`)
        .set(authHeaders(env.owner))
        .expect(204);
      await publish(
        env,
        env.owner,
        second.id,
        (draft.body as { revision: number }).revision,
      ).expect(201);
    } finally {
      await setLimitsAsOperator(env.organization.id, {
        maxNodes: 50,
        maxEdges: 100,
        maxDefinitionBytes: 262_144,
        maxActiveSchedules: 10,
      });
    }
  });

  it('blocks the publication of an unknown time zone or a malformed cron', async () => {
    for (const config of [
      { cron: '0 9 * * *', timezone: 'Mars/Olympus' },
      { cron: 'cada dia', timezone: 'UTC' },
    ]) {
      const workflow = await createWorkflow(env);
      const draft = await saveDraft(
        env,
        env.owner,
        workflow.id,
        1,
        scheduleDefinition(config.cron, config.timezone),
      ).expect(200);
      const response = await publish(
        env,
        env.owner,
        workflow.id,
        (draft.body as { revision: number }).revision,
      ).expect(422);
      expect(problemOf(response).code).toBe('DAG_INVALID');
    }
  });

  it('answers 404 without a schedule, lets a viewer read it and hides it from other organizations', async () => {
    const workflow = await createWorkflow(env);
    await api(env).get(schedulePath(workflow.id)).set(authHeaders(env.owner)).expect(404);
    const withSchedule = await scheduled();
    expect((await getSchedule(withSchedule.id, env.viewer)).desiredState).toBe('scheduled');
    await api(env).get(schedulePath(withSchedule.id)).set(authHeaders(env.outsider)).expect(404);
  });
});
