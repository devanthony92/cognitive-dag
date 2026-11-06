import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CompilationResultSchema,
  CompilationSchema,
  ProblemDetailsSchema,
} from '@cognitive-dag/contracts';
import { compilations, newId } from '@cognitive-dag/db';
import { randomUUID } from 'node:crypto';
import { withValkey } from './identity-helpers';
import {
  closeRunsEnv,
  createCompilation,
  cyclicAnswer,
  getCompilation,
  getCompilationResult,
  say,
  setupCompilerEnv,
  validAnswer,
  waitForCompilation,
  type CompilerEnv,
} from './compilations-helpers';

const INTENT = 'Clasifica correos y archiva el spam';

describe('compilation result from the Temporal history (requires docker compose up)', () => {
  let env: CompilerEnv;

  beforeAll(async () => {
    env = await setupCompilerEnv({
      COMPILER_MAX_PER_USER_HOUR: 1000,
      COMPILER_MAX_PER_ORG_DAY: 1000,
    });
    await withValkey((valkey) => valkey.del(`rl:compiler:user:${env.owner.body.user.id}`));
  }, 60_000);
  afterAll(async () => {
    await closeRunsEnv(env);
  });

  const compile = async () =>
    CompilationSchema.parse(
      (await createCompilation(env, env.owner, { intent: INTENT }).expect(202)).body,
    );

  /** A final row without a workflow in Temporal: what a purged history looks like. */
  const insertFinal = async (
    values: Partial<typeof compilations.$inferInsert> & { status: 'succeeded' | 'failed' },
  ) =>
    env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      async (tx) => {
        const id = await newId(tx);
        await tx.insert(compilations).values({
          id,
          organizationId: env.organization.id,
          requestedBy: env.owner.body.user.id,
          mode: 'create',
          intentChars: 10,
          model: 'test-compiler',
          correlationId: randomUUID(),
          finishedAt: new Date(),
          nodeCount: 3,
          ...(values.status === 'failed'
            ? { errorCode: 'COMPILER_INVALID_DAG', errorClass: 'invalid_output' }
            : {}),
          ...values,
        });
        return id;
      },
    );

  it('returns the generated DAG of a successful compilation', async () => {
    env.provider.script([say(validAnswer('Clasificar correos'))]);
    const created = await compile();
    const done = await waitForCompilation(env, env.owner, created.id);
    expect(done).toMatchObject({ status: 'succeeded', calls: 1, nodeCount: 5, hasFallback: false });
    expect(done.tokensUsed).toBeGreaterThan(0);

    const response = await getCompilationResult(env, env.viewer, created.id).expect(200);
    const result = CompilationResultSchema.parse(response.body);
    expect(result).toMatchObject({
      kind: 'result',
      title: 'Clasificar correos',
      validation: { valid: true, errors: [] },
      omittedSensitiveFields: [],
    });
    expect(result.definition).toMatchObject({ schemaVersion: 1 });
    expect((result.definition['nodes'] as unknown[]).length).toBe(5);
    // Positions come from the layout: no two nodes at the same place.
    const places = (result.definition['nodes'] as { position: { x: number; y: number } }[]).map(
      (node) => `${node.position.x},${node.position.y}`,
    );
    expect(new Set(places).size).toBe(places.length);
  });

  it('409 COMPILER_NOT_FINISHED while the compilation is in progress', async () => {
    env.provider.script([say(validAnswer())]);
    const release = env.provider.hold();
    try {
      const created = await compile();
      await waitForCompilation(env, env.owner, created.id, (c) => c.status === 'running');
      const response = await getCompilationResult(env, env.owner, created.id).expect(409);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('COMPILER_NOT_FINISHED');
    } finally {
      release();
    }
  });

  it('409 COMPILER_NOT_FINISHED for a queued compilation too', async () => {
    const id = await insertFinal({ status: 'succeeded' });
    // Not final: a fresh row stays queued.
    const queued = await env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      async (tx) => {
        const queuedId = await newId(tx);
        await tx.insert(compilations).values({
          id: queuedId,
          organizationId: env.organization.id,
          requestedBy: env.owner.body.user.id,
          mode: 'create',
          intentChars: 10,
          model: 'test-compiler',
          correlationId: randomUUID(),
        });
        return queuedId;
      },
    );
    expect(id).not.toBe(queued);
    const response = await getCompilationResult(env, env.owner, queued).expect(409);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('COMPILER_NOT_FINISHED');
  });

  it('returns the last attempt of a failed compilation as a fallback', async () => {
    env.provider.script([say(cyclicAnswer()), say(cyclicAnswer()), say(cyclicAnswer())]);
    const created = await compile();
    const done = await waitForCompilation(env, env.owner, created.id);
    expect(done).toMatchObject({
      status: 'failed',
      errorCode: 'COMPILER_INVALID_DAG',
      hasFallback: true,
      repairs: 2,
    });

    const response = await getCompilationResult(env, env.editor, created.id).expect(200);
    const result = CompilationResultSchema.parse(response.body);
    expect(result.kind).toBe('fallback');
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
  });

  it('409 COMPILER_NO_RESULT when it failed without a fallback', async () => {
    env.provider.script([say({ nope: 1 }), say({ nope: 2 }), say({ nope: 3 })]);
    const created = await compile();
    const done = await waitForCompilation(env, env.owner, created.id);
    expect(done).toMatchObject({ status: 'failed', hasFallback: false });

    const response = await getCompilationResult(env, env.owner, created.id).expect(409);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('COMPILER_NO_RESULT');
  });

  it('410 COMPILER_RESULT_EXPIRED when Temporal no longer has the history', async () => {
    const succeeded = await insertFinal({ status: 'succeeded' });
    const fallback = await insertFinal({ status: 'failed', hasFallback: true });
    for (const id of [succeeded, fallback]) {
      const response = await getCompilationResult(env, env.owner, id).expect(410);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('COMPILER_RESULT_EXPIRED');
    }
  });

  it('409 COMPILER_NO_RESULT for a failure without fallback even when the history is gone', async () => {
    const id = await insertFinal({ status: 'failed', hasFallback: false });
    const response = await getCompilationResult(env, env.owner, id).expect(409);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('COMPILER_NO_RESULT');
  });

  it('404 for the result of a compilation of another organization or an unknown id', async () => {
    env.provider.script([say(validAnswer())]);
    const created = await compile();
    await waitForCompilation(env, env.owner, created.id);
    await getCompilationResult(env, env.outsider, created.id).expect(404);
    await getCompilationResult(env, env.outsider, created.id, env.outsiderOrganization.id).expect(
      404,
    );
    await getCompilationResult(env, env.owner, randomUUID()).expect(404);
  });

  it('never exposes the intent or the DAG in the status or the database', async () => {
    env.provider.script([say(validAnswer('Titulo secreto-xyz'))]);
    const created = await createCompilation(env, env.owner, {
      intent: 'intencion-secreta-12345 con datos',
    }).expect(202);
    const id = CompilationSchema.parse(created.body).id;
    await waitForCompilation(env, env.owner, id);
    const status = await getCompilation(env, env.owner, id).expect(200);
    expect(JSON.stringify(status.body)).not.toMatch(/intencion-secreta|Titulo secreto/);
    const rows = await env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      (tx) => tx.select().from(compilations),
    );
    expect(JSON.stringify(rows)).not.toMatch(/intencion-secreta|Titulo secreto/);
  });
});
