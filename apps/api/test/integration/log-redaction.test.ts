import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RunSchema } from '@cognitive-dag/contracts';
import { startTestApp } from './helpers';
import { authHeaders } from './identity-helpers';
import {
  amountDefinition,
  api,
  closeRunsEnv,
  publishedWorkflow,
  runsPath,
  setupRunsEnv,
  startRun,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';
import { createWorkflow } from './workflows-helpers';

/**
 * F9 (T042, FR-027): user content never reaches the logs of the API, and the security events keep
 * `event`, `organizationId` and `correlationId` so they can be searched. The canary is a random value
 * made here and placed where a user puts content: the name of a workflow, the input of a run (valid
 * and invalid), a login with a wrong password and a registration. Everything the API writes to the
 * process output during the test is captured and searched for it.
 */
describe('log redaction (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;
  const lines: string[] = [];
  const canary = `canary-${randomBytes(9).toString('hex')}`;

  /** What the process writes to stdout or stderr, however pino reaches the descriptor. */
  function capture(fd: unknown, data: unknown): void {
    if (fd !== 1 && fd !== 2) return;
    const text = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf8');
    lines.push(...text.split('\n').filter(Boolean));
  }

  beforeAll(async () => {
    const writeSync = fs.writeSync.bind(fs) as (...args: unknown[]) => number;
    vi.spyOn(fs, 'writeSync').mockImplementation(
      (fd: unknown, data: unknown, ...rest: unknown[]) => {
        capture(fd, data);
        return writeSync(fd, data, ...rest);
      },
    );
    const write = fs.write.bind(fs) as (...args: unknown[]) => void;
    vi.spyOn(fs, 'write').mockImplementation((fd: unknown, data: unknown, ...rest: unknown[]) => {
      capture(fd, data);
      write(fd, data, ...rest);
    });
    const stdout = process.stdout.write.bind(process.stdout) as (...args: unknown[]) => boolean;
    vi.spyOn(process.stdout, 'write').mockImplementation((data: unknown, ...rest: unknown[]) => {
      capture(1, data);
      return stdout(data, ...rest);
    });
    // nestjs-pino builds one root logger per process, with the level of the first application:
    // that application is started here, at `info`, so the events are written. The spies come first
    // because the logger keeps the stream it finds when it is built.
    const first = await startTestApp({ LOG_LEVEL: 'info' });
    await first.close();
    env = await setupRunsEnv();
  });

  afterEach(() => {
    lines.length = 0;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeRunsEnv(env);
  });

  const parsed = (): Record<string, unknown>[] =>
    lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });

  it('keeps a canary out of the logs: names, run input, failed input and a wrong password', async () => {
    const workflow = await createWorkflow(env, env.owner, `Flujo ${canary}`);
    const workflowId = await publishedWorkflow(env, amountDefinition());

    const started = await startRun(env, env.owner, workflowId, { monto: 150, nota: canary }).expect(
      202,
    );
    await waitForTerminal(env, env.owner, RunSchema.parse(started.body).id);

    // An invalid input that carries the canary: the validation error must not echo it to the logs.
    await api(env)
      .post(runsPath(env.organization.id, workflowId))
      .set(authHeaders(env.owner))
      .send({ input: { monto: canary, nota: canary, [canary]: canary } })
      .expect(422);

    // A login with a wrong password that is the canary, and a registration that carries it.
    await api(env)
      .post('/api/v1/auth/login')
      .send({ email: `${canary}@example.test`, password: canary })
      .expect((response) => {
        expect([401, 429]).toContain(response.status);
      });
    await api(env)
      .post('/api/v1/auth/register')
      .send({ name: canary, email: `${canary.slice(0, 20)}@example.test`, password: canary })
      .expect((response) => {
        expect([202, 422, 429]).toContain(response.status);
      });

    expect(workflow.id).toBeTruthy();
    expect(lines.length).toBeGreaterThan(0);
    const leaks = lines.filter((line) => line.includes(canary));
    expect(leaks, 'log lines that contain the canary').toEqual([]);
  });

  it('keeps event, organizationId and correlationId in the security events', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition());
    const started = await startRun(env, env.owner, workflowId).expect(202);
    await waitForTerminal(env, env.owner, RunSchema.parse(started.body).id);

    const events = parsed().filter((entry) => entry['securityEvent'] === true);
    const names = events.map((entry) => entry['event']);
    expect(names).toContain('workflow.created');
    expect(names).toContain('run.started');
    for (const entry of events.filter((e) =>
      ['workflow.created', 'run.started'].includes(String(e['event'])),
    )) {
      expect(entry['organizationId']).toBe(env.organization.id);
      expect(typeof entry['correlationId']).toBe('string');
      expect(String(entry['correlationId']).length).toBeGreaterThan(10);
      expect(entry['outcome']).toBe('success');
    }
    // A security event carries ids and a fixed vocabulary, never a free text field.
    for (const entry of events) {
      for (const key of Object.keys(entry)) {
        expect([
          'level',
          'time',
          'component',
          'context',
          'securityEvent',
          'event',
          'outcome',
          'userId',
          'organizationId',
          'ip',
          'nodeId',
          'reason',
          'resourceId',
          'correlationId',
          'msg',
          'req',
          'res',
          'responseTime',
          'pid',
          'hostname',
        ]).toContain(key);
      }
    }
  });
});
