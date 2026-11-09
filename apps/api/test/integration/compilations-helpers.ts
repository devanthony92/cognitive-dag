import { defaultPayloadConverter } from '@temporalio/common';
import { Client, Connection } from '@temporalio/client';
import { CompilationSchema, type Compilation } from '@cognitive-dag/contracts';
import { FakeProvider, type FakeStep, type LlmProvider, type LlmRequest } from '@cognitive-dag/llm';
import { type LoggedIn } from './identity-helpers';
import { authHeaders } from './identity-helpers';
import { testConfig } from './helpers';
import { waitFor } from './ping-helpers';
import { RUN_FLAGS, api, closeRunsEnv, setupRunsEnv, type RunsEnv } from './runs-helpers';

export const COMPILER_FLAGS = RUN_FLAGS;

export const compilationsPath = (organizationId: string) =>
  `/api/v1/organizations/${organizationId}/compilations`;

/**
 * Provider of the LLM worker whose script each test replaces; `hold()` keeps the next call
 * waiting until the returned function is called, to observe a compilation in progress.
 */
export class SwitchableProvider implements LlmProvider {
  private current = new FakeProvider([]);
  private gate: Promise<void> | undefined;

  script(steps: readonly FakeStep[]): void {
    this.current = new FakeProvider(steps);
    this.gate = undefined;
  }

  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async generate(request: LlmRequest) {
    if (this.gate) await this.gate;
    return this.current.generate(request);
  }
}

export interface CompilerEnv extends RunsEnv {
  provider: SwitchableProvider;
}

/** An environment with the LLM worker serving the compiler, backed by a scriptable provider. */
export async function setupCompilerEnv(
  overrides: Parameters<typeof setupRunsEnv>[0] = {},
): Promise<CompilerEnv> {
  const provider = new SwitchableProvider();
  const env = await setupRunsEnv(
    { FEATURE_FLAGS: COMPILER_FLAGS, ...overrides },
    { llm: true, provider, compiler: true },
  );
  return Object.assign(env, { provider });
}

export { closeRunsEnv, setupRunsEnv };

type Env = Pick<RunsEnv, 'app' | 'organization'>;

export function createCompilation(
  env: Env,
  session: LoggedIn,
  body: Record<string, unknown> = { intent: 'Clasifica correos y archiva el spam' },
  organizationId = env.organization.id,
) {
  return api(env).post(compilationsPath(organizationId)).set(authHeaders(session)).send(body);
}

export function getCompilation(
  env: Env,
  session: LoggedIn,
  id: string,
  organizationId = env.organization.id,
) {
  return api(env)
    .get(`${compilationsPath(organizationId)}/${id}`)
    .set('Cookie', session.cookie);
}

export function getCompilationResult(
  env: Env,
  session: LoggedIn,
  id: string,
  organizationId = env.organization.id,
) {
  return api(env)
    .get(`${compilationsPath(organizationId)}/${id}/result`)
    .set('Cookie', session.cookie);
}

const isFinal = (compilation: Compilation): boolean =>
  compilation.status === 'succeeded' || compilation.status === 'failed';

/** Polls until the compilation satisfies `done` (by default, until it is final). */
export function waitForCompilation(
  env: Env,
  session: LoggedIn,
  id: string,
  done: (compilation: Compilation) => boolean = isFinal,
): Promise<Compilation> {
  return waitFor(async () => {
    const response = await getCompilation(env, session, id).expect(200);
    const compilation = CompilationSchema.parse(response.body);
    return done(compilation) ? compilation : undefined;
  }, 30_000);
}

/** The input the `compile-<id>` workflow was started with, read from its Temporal history. */
export async function compileInputOf(id: string): Promise<Record<string, unknown>> {
  const config = testConfig();
  const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
    const history = await waitFor(async () => {
      try {
        return await client.workflow.getHandle(`compile-${id}`).fetchHistory();
      } catch {
        return undefined;
      }
    });
    const started = history.events?.find((event) => event.workflowExecutionStartedEventAttributes);
    const payload = started?.workflowExecutionStartedEventAttributes?.input?.payloads?.[0];
    return defaultPayloadConverter.fromPayload<Record<string, unknown>>(payload!);
  } finally {
    await connection.close();
  }
}

/** Manual trigger, classify, condition and a service on each branch: a valid answer. */
export function validAnswer(title = 'Clasificar correos') {
  return {
    title,
    nodes: [
      {
        id: 'start',
        type: 'trigger.manual',
        label: 'Inicio',
        config: { inputSchema: [{ name: 'body', type: { kind: 'string' } }] },
      },
      {
        id: 'classify',
        type: 'llm.classify',
        label: 'Clasificar',
        config: { text: '{{nodes.start.output.body}}', labels: ['spam', 'ham'] },
      },
      {
        id: 'is_spam',
        type: 'logic.condition',
        label: '¿Es spam?',
        config: {
          condition: {
            op: 'eq',
            left: { kind: 'ref', path: 'nodes.classify.output.label' },
            right: { kind: 'literal', type: 'string', value: 'spam' },
          },
        },
      },
      {
        id: 'archive',
        type: 'mock.service',
        label: 'Archivar',
        config: { latencyMs: 100, failureRate: 0, failureKind: 'transient' },
      },
      {
        id: 'reply',
        type: 'mock.service',
        label: 'Responder',
        config: { latencyMs: 100, failureRate: 0, failureKind: 'transient' },
      },
    ],
    edges: [
      { from: 'start', fromHandle: 'out', to: 'classify' },
      { from: 'classify', fromHandle: 'out', to: 'is_spam' },
      { from: 'is_spam', fromHandle: 'true', to: 'archive' },
      { from: 'is_spam', fromHandle: 'false', to: 'reply' },
    ],
  };
}

/** The same answer with a connection back to `classify`: it fits the schema but has a cycle. */
export function cyclicAnswer() {
  const dag = validAnswer();
  return { ...dag, edges: [...dag.edges, { from: 'reply', fromHandle: 'out', to: 'classify' }] };
}

export const say = (value: unknown): FakeStep => ({ text: JSON.stringify(value) });
