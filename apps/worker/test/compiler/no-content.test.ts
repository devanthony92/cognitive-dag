import { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FakeStep } from '@cognitive-dag/llm';
import {
  CompilerHarness,
  answer,
  cyclicDag,
  readState,
  seedCompilation,
  validDag,
} from './support';

// SC-005: the intent and the generated DAG live only in the Temporal history. Neither the logs
// nor the rows of PostgreSQL carry them.

/** Text marked so any copy of it is found. */
const MARKER = 'ZEBRA-7731-NO-LOG';
const INTENT = `Cada vez que llegue un correo de ${MARKER}, clasifícalo y responde.`;
/** Words that only the generated DAG contains. */
const DAG_TEXT = ['Clasificar correos', '¿Es spam?', 'Archivar', 'Responder', 'is_spam'];

describe('no content in logs or tables (requires docker compose up)', () => {
  let harness: CompilerHarness;

  beforeAll(async () => {
    harness = new CompilerHarness(await TestWorkflowEnvironment.createLocal());
    harness.start();
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
    await harness?.env.teardown();
  });

  /** Everything a compilation leaves in PostgreSQL, as one string. */
  async function rowsOf(seed: Awaited<ReturnType<typeof seedCompilation>>): Promise<string> {
    const state = await readState(harness.pool, seed);
    return JSON.stringify(state);
  }

  async function leftovers(script: readonly FakeStep[]) {
    const seed = await seedCompilation(harness.pool, { intentChars: INTENT.length });
    const before = harness.logs.length;
    const { result } = await harness.compile(seed, { provider: script }, { intent: INTENT });
    return {
      result,
      logs: harness.logs.slice(before).join(''),
      rows: await rowsOf(seed),
    };
  }

  it('leaves no trace of the intent or the DAG after a successful compilation', async () => {
    const left = await leftovers([answer(validDag())]);
    expect(left.result?.status).toBe('succeeded');
    // Control: the content does exist, in the value the workflow returns.
    expect(JSON.stringify(left.result)).toContain('Clasificar correos');
    expect(left.logs.length).toBeGreaterThan(0);
    for (const text of [MARKER, 'correo', ...DAG_TEXT]) {
      expect(left.logs).not.toContain(text);
      expect(left.rows).not.toContain(text);
    }
  }, 60_000);

  it('leaves no trace after repairs and a fallback', async () => {
    const left = await leftovers([answer(cyclicDag()), answer(cyclicDag()), answer(cyclicDag())]);
    expect(left.result?.status).toBe('failed');
    for (const text of [MARKER, ...DAG_TEXT]) {
      expect(left.logs).not.toContain(text);
      expect(left.rows).not.toContain(text);
    }
  }, 60_000);

  it('leaves no trace when the model and the provider echo the intent', async () => {
    const left = await leftovers([
      { error: Object.assign(new Error(`provider echoes ${INTENT}`), { status: 503 }) },
      { text: JSON.stringify({ title: INTENT, nodes: [], edges: [], extra: MARKER }) },
      { text: `not json ${MARKER}` },
      { text: JSON.stringify({ title: MARKER }) },
    ]);
    expect(left.result?.status).toBe('failed');
    expect(left.logs).not.toContain(MARKER);
    expect(left.rows).not.toContain(MARKER);
  }, 60_000);

  it('stores only the size of the intent', async () => {
    const seed = await seedCompilation(harness.pool, { intentChars: INTENT.length });
    await harness.compile(seed, { provider: [answer(validDag())] }, { intent: INTENT });
    const state = await readState(harness.pool, seed);
    expect(state.compilation).not.toHaveProperty('intent');
    expect(Object.keys(state.compilation ?? {}).sort()).not.toContain('definition');
  }, 60_000);
});
