import { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompilerHarness, answer, seedCompilation, validDag, type Seeded } from './support';

// SC-003: a compilation produces a proposal and nothing else. It never publishes a version,
// never activates one and never starts an execution.

interface Footprint {
  versions: number;
  activeVersions: number;
  runs: number;
  steps: number;
  draftRevision: number | null;
  draft: unknown;
}

describe('a compilation executes nothing (requires docker compose up)', () => {
  let harness: CompilerHarness;

  beforeAll(async () => {
    harness = new CompilerHarness(await TestWorkflowEnvironment.createLocal());
    harness.start();
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
    await harness?.env.teardown();
  });

  async function footprint(seed: Seeded): Promise<Footprint> {
    const client = await harness.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        seed.organizationId,
      ]);
      const count = async (table: string): Promise<number> =>
        Number(
          (
            await client.query<{ n: string }>(
              `SELECT count(*) AS n FROM ${table} WHERE organization_id = $1`,
              [seed.organizationId],
            )
          ).rows[0]?.n,
        );
      const workflow = seed.workflowId
        ? (
            await client.query<{ draft_revision: number; draft: unknown }>(
              'SELECT draft_revision, draft_definition AS draft FROM workflows WHERE id = $1',
              [seed.workflowId],
            )
          ).rows[0]
        : undefined;
      const result = {
        versions: await count('workflow_versions'),
        activeVersions: await count('workflow_active_versions'),
        runs: await count('workflow_runs'),
        steps: await count('workflow_run_steps'),
        draftRevision: workflow?.draft_revision ?? null,
        draft: workflow?.draft ?? null,
      };
      await client.query('COMMIT');
      return result;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  it('creates no version, no active version, no run and no step (mode create)', async () => {
    const seed = await seedCompilation(harness.pool);
    const before = await footprint(seed);
    const { result } = await harness.compile(seed, { provider: [answer(validDag())] });
    expect(result?.status).toBe('succeeded');
    expect(await footprint(seed)).toEqual(before);
    expect(before).toMatchObject({ versions: 0, activeVersions: 0, runs: 0, steps: 0 });
  }, 60_000);

  it('leaves the draft of the workflow untouched (mode regenerate)', async () => {
    const seed = await seedCompilation(harness.pool, { mode: 'regenerate' });
    const before = await footprint(seed);
    const { result } = await harness.compile(seed, { provider: [answer(validDag())] });
    expect(result?.status).toBe('succeeded');
    const after = await footprint(seed);
    expect(after).toEqual(before);
    expect(after.draftRevision).toBe(before.draftRevision);
  }, 60_000);

  it('starts no Temporal workflow other than compile-<id>', async () => {
    const seed = await seedCompilation(harness.pool);
    await harness.compile(seed, { provider: [answer(validDag())] });
    const types = new Set<string>();
    for await (const workflow of harness.env.client.workflow.list({
      query: `WorkflowId = "compile-${seed.compilationId}" OR WorkflowType = "executeDag"`,
    })) {
      types.add(`${workflow.type}:${workflow.workflowId}`);
    }
    expect([...types]).toEqual([`compileIntent:compile-${seed.compilationId}`]);
  }, 60_000);

  it('also leaves no execution when the compilation fails', async () => {
    const seed = await seedCompilation(harness.pool);
    const before = await footprint(seed);
    const { result } = await harness.compile(seed, { provider: [{ text: '{}', blocked: true }] });
    expect(result?.status).toBe('failed');
    expect(await footprint(seed)).toEqual(before);
  }, 60_000);
});
