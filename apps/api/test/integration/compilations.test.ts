import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CompilationListSchema,
  CompilationSchema,
  ProblemDetailsSchema,
} from '@cognitive-dag/contracts';
import { authHeaders, withValkey } from './identity-helpers';
import {
  COMPILER_FLAGS_OFF,
  COMPILER_FLAGS_WITHOUT_LLM,
  closeRunsEnv,
  compilationsPath,
  compileInputOf,
  createCompilation,
  getCompilation,
  setupCompilerEnv,
  setupRunsEnv,
  type CompilerEnv,
} from './compilations-helpers';
import type { RunsEnv } from './runs-helpers';
import { api, createWorkflow, saveDraft, validDefinition } from './workflows-helpers';

const INTENT = 'Clasifica correos y archiva el spam';
const bucketOf = (userId: string) => `rl:compiler:user:${userId}`;

describe('compilations (requires docker compose up and pnpm db:migrate)', () => {
  let env: CompilerEnv;

  beforeAll(async () => {
    env = await setupCompilerEnv();
    await withValkey((valkey) =>
      valkey.del(...[env.owner, env.editor].map((session) => bucketOf(session.body.user.id))),
    );
  }, 60_000);
  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('202 with a queued compilation in mode create, a Location and no content', async () => {
    const release = env.provider.hold();
    try {
      const response = await createCompilation(env, env.owner, { intent: INTENT }).expect(202);
      const compilation = CompilationSchema.parse(response.body);
      expect(compilation).toMatchObject({
        mode: 'create',
        workflowId: null,
        baseDraftRevision: null,
        status: 'queued',
        calls: 0,
        repairs: 0,
        tokensUsed: 0,
        hasFallback: false,
        requestedBy: env.owner.body.user.id,
        finishedAt: null,
      });
      expect(compilation.model.length).toBeGreaterThan(0);
      expect(response.headers['location']).toBe(
        `${compilationsPath(env.organization.id)}/${compilation.id}`,
      );
      expect(JSON.stringify(response.body)).not.toContain(INTENT);
    } finally {
      release();
    }
  });

  it('starts the workflow compile-<id> with the intent and the F5 catalog', async () => {
    const response = await createCompilation(env, env.owner, { intent: INTENT }).expect(202);
    const { id } = CompilationSchema.parse(response.body);
    const input = await compileInputOf(id);
    expect(input).toMatchObject({
      compilationId: id,
      organizationId: env.organization.id,
      intent: INTENT,
    });
    expect(input['allowedTypes']).toEqual(
      expect.arrayContaining(['trigger.manual', 'llm.classify', 'llm.generate']),
    );
    expect(input['llmTaskQueue']).toEqual(expect.any(String));
  });

  it('trims the intent', async () => {
    const response = await createCompilation(env, env.owner, {
      intent: `   ${INTENT}   `,
    }).expect(202);
    const input = await compileInputOf(CompilationSchema.parse(response.body).id);
    expect(input['intent']).toBe(INTENT);
  });

  it('mode regenerate stores the current draft revision', async () => {
    const workflow = await createWorkflow(env, env.owner);
    await saveDraft(env, env.owner, workflow.id, 1, validDefinition()).expect(200);
    const response = await createCompilation(env, env.owner, {
      intent: INTENT,
      workflowId: workflow.id,
    }).expect(202);
    expect(CompilationSchema.parse(response.body)).toMatchObject({
      mode: 'regenerate',
      workflowId: workflow.id,
      baseDraftRevision: 2,
    });
  });

  it('404 for a workflow that does not exist or belongs to another organization', async () => {
    await createCompilation(env, env.owner, {
      intent: INTENT,
      workflowId: '0198a000-0000-7000-8000-000000000000',
    }).expect(404);
    const foreign = await createWorkflow(env, env.outsider, undefined, env.outsiderOrganization.id);
    const response = await createCompilation(env, env.owner, {
      intent: INTENT,
      workflowId: foreign.id,
    }).expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('NOT_FOUND');
  });

  it('400 for an empty intent and COMPILER_INTENT_TOO_LONG above 2000 characters', async () => {
    for (const intent of ['', '   \n  ']) {
      const response = await createCompilation(env, env.owner, { intent }).expect(400);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('VALIDATION_FAILED');
    }
    const tooLong = await createCompilation(env, env.owner, { intent: 'a'.repeat(2001) }).expect(
      400,
    );
    expect(ProblemDetailsSchema.parse(tooLong.body).code).toBe('COMPILER_INTENT_TOO_LONG');
    // The limit counts after trimming: 2000 characters plus spaces is accepted.
    await createCompilation(env, env.owner, { intent: ` ${'a'.repeat(2000)} ` }).expect(202);
  });

  it('422 for unknown fields', async () => {
    await createCompilation(env, env.owner, { intent: INTENT, extra: 1 }).expect(422);
  });

  it('lets owner and editor create and forbids the viewer', async () => {
    await createCompilation(env, env.editor, { intent: INTENT }).expect(202);
    const response = await createCompilation(env, env.viewer, { intent: INTENT }).expect(403);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('FORBIDDEN');
  });

  it('lets any role read the list and one compilation', async () => {
    const created = CompilationSchema.parse(
      (await createCompilation(env, env.editor, { intent: INTENT }).expect(202)).body,
    );
    const one = await getCompilation(env, env.viewer, created.id).expect(200);
    expect(CompilationSchema.parse(one.body).id).toBe(created.id);

    const list = await api(env)
      .get(compilationsPath(env.organization.id))
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    const items = CompilationListSchema.parse(list.body).items;
    expect(items.length).toBeLessThanOrEqual(20);
    expect(items.map((item) => item.id)).toContain(created.id);
    const times = items.map((item) => Date.parse(item.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filters the list by workflow', async () => {
    const workflow = await createWorkflow(env, env.owner);
    const mine = CompilationSchema.parse(
      (
        await createCompilation(env, env.owner, {
          intent: INTENT,
          workflowId: workflow.id,
        }).expect(202)
      ).body,
    );
    const list = await api(env)
      .get(`${compilationsPath(env.organization.id)}?workflowId=${workflow.id}`)
      .set('Cookie', env.owner.cookie)
      .expect(200);
    expect(CompilationListSchema.parse(list.body).items.map((item) => item.id)).toEqual([mine.id]);
  });

  it('404 for a compilation of another organization, even by id', async () => {
    const created = CompilationSchema.parse(
      (await createCompilation(env, env.owner, { intent: INTENT }).expect(202)).body,
    );
    // The outsider is not a member of the organization in the route.
    await getCompilation(env, env.outsider, created.id).expect(404);
    await createCompilation(env, env.outsider, { intent: INTENT }).expect(404);
    // Through its own organization the compilation does not exist either (row-level security).
    await getCompilation(env, env.outsider, created.id, env.outsiderOrganization.id).expect(404);
    await api(env)
      .get(compilationsPath(env.organization.id))
      .set('Cookie', env.outsider.cookie)
      .expect(404);
  });

  it('422 for a malformed id', async () => {
    await getCompilation(env, env.owner, 'not-a-uuid').expect(422);
  });

  it('requires a session', async () => {
    await api(env).get(compilationsPath(env.organization.id)).expect(401);
  });
});

describe('compilations without llm-nodes-enabled', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv({ FEATURE_FLAGS: COMPILER_FLAGS_WITHOUT_LLM });
    await withValkey((valkey) => valkey.del(bucketOf(env.owner.body.user.id)));
  }, 60_000);
  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('gives the workflow only the types executable in F3', async () => {
    const response = await createCompilation(env, env.owner, { intent: INTENT }).expect(202);
    const input = await compileInputOf(CompilationSchema.parse(response.body).id);
    const types = input['allowedTypes'] as string[];
    expect(types).toEqual(
      expect.arrayContaining(['trigger.manual', 'logic.condition', 'mock.service']),
    );
    expect(types.filter((type) => type.startsWith('llm.'))).toEqual([]);
  });
});

describe('compilations with nl-compiler-enabled off', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv({ FEATURE_FLAGS: COMPILER_FLAGS_OFF });
  }, 60_000);
  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('answers 404 FEATURE_NOT_AVAILABLE on every endpoint', async () => {
    const id = '0198a000-0000-7000-8000-000000000000';
    const base = compilationsPath(env.organization.id);
    const responses = [
      await createCompilation(env, env.owner, { intent: INTENT }),
      await api(env).get(base).set(authHeaders(env.owner)),
      await api(env).get(`${base}/${id}`).set(authHeaders(env.owner)),
      await api(env).get(`${base}/${id}/result`).set(authHeaders(env.owner)),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('FEATURE_NOT_AVAILABLE');
    }
  });
});

describe('compilation limits', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv({
      FEATURE_FLAGS: COMPILER_FLAGS_WITHOUT_LLM,
      COMPILER_MAX_PER_USER_HOUR: 2,
      COMPILER_MAX_PER_ORG_DAY: 4,
    });
    await withValkey((valkey) =>
      valkey.del(
        ...[env.owner, env.editor, env.outsider].map((session) => bucketOf(session.body.user.id)),
      ),
    );
  }, 60_000);
  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('429 COMPILER_RATE_LIMITED with Retry-After per person', async () => {
    await createCompilation(env, env.owner, { intent: INTENT }).expect(202);
    await createCompilation(env, env.owner, { intent: INTENT }).expect(202);
    const limited = await createCompilation(env, env.owner, { intent: INTENT }).expect(429);
    const problem = ProblemDetailsSchema.parse(limited.body);
    expect(problem.code).toBe('COMPILER_RATE_LIMITED');
    expect(problem.retryAfterSeconds).toBeGreaterThan(0);
    // 2 per hour: one token every 30 minutes.
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(1800);
  });

  it('429 COMPILER_DAILY_LIMIT per organization on the UTC day, counting rows', async () => {
    // The owner already created 2 above; the editor adds 2 more (its own bucket) to reach 4.
    await createCompilation(env, env.editor, { intent: INTENT }).expect(202);
    await createCompilation(env, env.editor, { intent: INTENT }).expect(202);
    const limited = await createCompilation(env, env.editor, { intent: INTENT }).expect(429);
    expect(ProblemDetailsSchema.parse(limited.body).code).toBe('COMPILER_DAILY_LIMIT');
    expect(limited.headers['retry-after']).toBeUndefined();
  });

  it('checks the day first, so a refused request spends no token', async () => {
    const before = await withValkey((valkey) =>
      valkey.hget(bucketOf(env.editor.body.user.id), 'tokens'),
    );
    await createCompilation(env, env.editor, { intent: INTENT }).expect(429);
    const after = await withValkey((valkey) =>
      valkey.hget(bucketOf(env.editor.body.user.id), 'tokens'),
    );
    expect(after).toBe(before);
  });

  it('keeps the count of another organization apart', async () => {
    await createCompilation(
      env,
      env.outsider,
      { intent: INTENT },
      env.outsiderOrganization.id,
    ).expect(202);
  });
});
