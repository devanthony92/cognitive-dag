import { describe, expect, it } from 'vitest';
import { NODE_CATALOG, NODE_TYPES, type NodeType } from '../src/index.js';

const ALL_TYPES: NodeType[] = [
  'trigger.manual',
  'trigger.webhook',
  'trigger.schedule',
  'llm.classify',
  'llm.extract',
  'llm.generate',
  'logic.condition',
  'logic.merge',
  'human.approval',
  'http.request',
  'mock.service',
];

const EXECUTABLE_FROM: Record<NodeType, string> = {
  'trigger.manual': 'F3',
  'trigger.webhook': 'F7',
  'trigger.schedule': 'F7',
  'llm.classify': 'F5',
  'llm.extract': 'F5',
  'llm.generate': 'F5',
  'logic.condition': 'F3',
  'logic.merge': 'F3',
  'human.approval': 'F7',
  'http.request': 'F7',
  'mock.service': 'F3',
};

const HANDLES: Partial<Record<NodeType, string[]>> = {
  'logic.condition': ['true', 'false'],
  'human.approval': ['approved', 'rejected', 'timeout'],
};

const TEMPLATABLE: Partial<Record<NodeType, string[]>> = {
  'llm.classify': ['text'],
  'llm.extract': ['text'],
  'llm.generate': ['instruction'],
  'human.approval': ['message'],
  'http.request': ['url', 'body'],
};

describe('node catalog (research R3)', () => {
  it('declares exactly the 11 node types', () => {
    expect([...NODE_TYPES].sort()).toEqual([...ALL_TYPES].sort());
    expect(Object.keys(NODE_CATALOG).sort()).toEqual([...ALL_TYPES].sort());
  });

  it.each(ALL_TYPES)('%s has a valid default configuration', (type) => {
    const entry = NODE_CATALOG[type];
    expect(entry.type).toBe(type);
    expect(entry.configSchema.safeParse(entry.defaultConfig()).success).toBe(true);
    expect(entry.label.length).toBeGreaterThan(0);
    expect(entry.description.length).toBeGreaterThan(0);
  });

  it.each(ALL_TYPES)('%s declares executableFrom, handles and templatableFields', (type) => {
    const entry = NODE_CATALOG[type];
    expect(entry.executableFrom).toBe(EXECUTABLE_FROM[type]);
    expect([...entry.handles]).toEqual(HANDLES[type] ?? ['out']);
    expect([...entry.templatableFields]).toEqual(TEMPLATABLE[type] ?? []);
  });

  it('only triggers reject incoming connections', () => {
    for (const type of ALL_TYPES) {
      expect(NODE_CATALOG[type].acceptsInput).toBe(!type.startsWith('trigger.'));
    }
  });

  it('every templatable field is a string in the default configuration', () => {
    for (const type of ALL_TYPES) {
      const config = NODE_CATALOG[type].defaultConfig() as Record<string, unknown>;
      for (const field of NODE_CATALOG[type].templatableFields) {
        expect(typeof config[field]).toBe('string');
      }
    }
  });

  it('rejects unknown fields in every configuration', () => {
    for (const type of ALL_TYPES) {
      const entry = NODE_CATALOG[type];
      const config = { ...(entry.defaultConfig() as object), unexpected: true };
      expect(entry.configSchema.safeParse(config).success).toBe(false);
    }
  });
});

describe('computed outputs', () => {
  it('trigger.manual exposes its input schema fields', () => {
    const config = NODE_CATALOG['trigger.manual'].configSchema.parse({
      inputSchema: [
        { name: 'email', type: { kind: 'string' } },
        { name: 'age', type: { kind: 'number' } },
      ],
    });
    expect(NODE_CATALOG['trigger.manual'].outputSchema(config)).toEqual({
      kind: 'object',
      fields: { email: { kind: 'string' }, age: { kind: 'number' } },
    });
  });

  it('trigger.webhook exposes the expected body fields', () => {
    const config = NODE_CATALOG['trigger.webhook'].configSchema.parse({
      bodySchema: [{ name: 'order_id', type: { kind: 'string' } }],
    });
    expect(NODE_CATALOG['trigger.webhook'].outputSchema(config)).toEqual({
      kind: 'object',
      fields: { order_id: { kind: 'string' } },
    });
  });

  it('trigger.schedule exposes the firing time', () => {
    const entry = NODE_CATALOG['trigger.schedule'];
    expect(entry.outputSchema(entry.defaultConfig())).toEqual({
      kind: 'object',
      fields: { firedAt: { kind: 'datetime' } },
    });
  });

  it('llm.classify exposes label as an enum of the configured labels, and confidence', () => {
    const entry = NODE_CATALOG['llm.classify'];
    const config = entry.configSchema.parse({ text: 'x', labels: ['spam', 'ham'] });
    expect(entry.outputSchema(config)).toEqual({
      kind: 'object',
      fields: { label: { kind: 'enum', values: ['spam', 'ham'] }, confidence: { kind: 'number' } },
    });
  });

  it('llm.extract exposes the declared fields', () => {
    const entry = NODE_CATALOG['llm.extract'];
    const config = entry.configSchema.parse({
      text: 'x',
      fields: [
        { name: 'total', type: { kind: 'number' } },
        { name: 'due', type: { kind: 'datetime' } },
      ],
    });
    expect(entry.outputSchema(config)).toEqual({
      kind: 'object',
      fields: { total: { kind: 'number' }, due: { kind: 'datetime' } },
    });
  });

  it('llm.generate, http.request, human.approval and mock.service have fixed outputs', () => {
    const fixed = (type: NodeType) =>
      NODE_CATALOG[type].outputSchema(NODE_CATALOG[type].defaultConfig());
    expect(fixed('llm.generate')).toEqual({ kind: 'object', fields: { text: { kind: 'string' } } });
    expect(fixed('http.request')).toEqual({
      kind: 'object',
      fields: { status: { kind: 'number' }, body: { kind: 'string' } },
    });
    expect(fixed('human.approval')).toEqual({
      kind: 'object',
      fields: {
        decision: { kind: 'enum', values: ['approved', 'rejected', 'timeout'] },
        approvedBy: { kind: 'string' },
      },
    });
    expect(fixed('mock.service')).toEqual({ kind: 'object', fields: { ok: { kind: 'boolean' } } });
  });

  it('logic nodes have no output', () => {
    expect(
      NODE_CATALOG['logic.condition'].outputSchema(NODE_CATALOG['logic.condition'].defaultConfig()),
    ).toBeNull();
    expect(
      NODE_CATALOG['logic.merge'].outputSchema(NODE_CATALOG['logic.merge'].defaultConfig()),
    ).toBeNull();
  });
});

describe('field-list configurations', () => {
  it('rejects duplicate or invalid field names', () => {
    const schema = NODE_CATALOG['trigger.manual'].configSchema;
    const f = { type: { kind: 'string' } };
    expect(
      schema.safeParse({
        inputSchema: [
          { name: 'a', ...f },
          { name: 'a', ...f },
        ],
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ inputSchema: [{ name: 'Bad Name', ...f }] }).success).toBe(false);
    expect(schema.safeParse({ inputSchema: [{ name: 'ok', ...f }] }).success).toBe(true);
  });

  it('requires at least two distinct labels in llm.classify', () => {
    const schema = NODE_CATALOG['llm.classify'].configSchema;
    expect(schema.safeParse({ text: 'x', labels: ['a'] }).success).toBe(false);
    expect(schema.safeParse({ text: 'x', labels: ['a', 'a'] }).success).toBe(false);
    expect(schema.safeParse({ text: 'x', labels: ['a', 'b'] }).success).toBe(true);
  });
});

describe('http.request (FR-005)', () => {
  const schema = NODE_CATALOG['http.request'].configSchema;
  const base = { method: 'GET', body: '' };

  it('accepts https URLs, including templates after the host', () => {
    expect(schema.safeParse({ ...base, url: 'https://api.example.com/v1' }).success).toBe(true);
    expect(
      schema.safeParse({
        ...base,
        url: 'https://api.example.com/{{nodes.trigger.output.message}}',
      }).success,
    ).toBe(true);
  });

  it.each([
    'http://api.example.com',
    'ftp://api.example.com',
    '//api.example.com',
    'api.example.com',
    'javascript:alert(1)',
    'https://',
    'https://{{nodes.trigger.output.message}}.example.com',
    'https://user:pass@api.example.com',
    'https://api.example.com /x',
  ])('rejects the URL %s', (url) => {
    expect(schema.safeParse({ ...base, url }).success).toBe(false);
  });

  it.each(['Authorization', 'authorization', 'Proxy-Authorization', 'Cookie', 'X-Api-Key'])(
    'rejects the header %s',
    (name) => {
      const result = schema.safeParse({
        ...base,
        url: 'https://a.example.com',
        headers: { [name]: 'x' },
      });
      expect(result.success).toBe(false);
    },
  );

  it('rejects secret-looking header names and credential values', () => {
    const url = 'https://a.example.com';
    expect(schema.safeParse({ ...base, url, headers: { 'X-Auth-Token': 'x' } }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...base, url, headers: { 'X-Custom': 'Bearer abc' } }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...base, url, headers: { 'X-Custom': 'Basic abc' } }).success).toBe(
      false,
    );
  });

  it('accepts harmless headers', () => {
    const result = schema.safeParse({
      ...base,
      url: 'https://a.example.com',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects secret-like fields in the configuration', () => {
    for (const key of ['authorization', 'apiKey', 'password', 'token', 'secret']) {
      const config = { ...base, url: 'https://a.example.com', [key]: 'x' };
      expect(schema.safeParse(config).success).toBe(false);
    }
  });
});

describe('other configuration limits', () => {
  it('validates the cron expression shape of trigger.schedule', () => {
    const schema = NODE_CATALOG['trigger.schedule'].configSchema;
    expect(schema.safeParse({ cron: '*/5 * * * *', timezone: 'America/Bogota' }).success).toBe(
      true,
    );
    expect(schema.safeParse({ cron: 'every day', timezone: 'UTC' }).success).toBe(false);
    expect(schema.safeParse({ cron: '* * * *', timezone: 'UTC' }).success).toBe(false);
  });

  it('bounds mock.service latency and failure rate', () => {
    const schema = NODE_CATALOG['mock.service'].configSchema;
    expect(
      schema.safeParse({ latencyMs: -1, failureRate: 0, failureKind: 'transient' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ latencyMs: 10, failureRate: 1.5, failureKind: 'transient' }).success,
    ).toBe(false);
    expect(schema.safeParse({ latencyMs: 10, failureRate: 0.5, failureKind: 'nope' }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ latencyMs: 10, failureRate: 0.5, failureKind: 'permanent' }).success,
    ).toBe(true);
  });
});
