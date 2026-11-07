import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApprovalCountSchema,
  ApprovalDetailSchema,
  ApprovalListQuerySchema,
  ApprovalListSchema,
  ApprovalSchema,
  CreateCredentialRequestSchema,
  CredentialSchema,
  DECIDE_APPROVAL_UPDATE_NAME,
  DecideApprovalRequestSchema,
  DecideApprovalUpdateInputSchema,
  DecideApprovalUpdateResultSchema,
  ExecuteDagInputSchema,
  FEATURE_FLAGS,
  HTTP_ALLOWED_HOSTS_MAX,
  HTTP_STEP_ERROR_CODES,
  HttpAllowedHostListSchema,
  HttpAllowedHostSchema,
  AddHttpAllowedHostRequestSchema,
  ProblemCodeSchema,
  ProblemDetailsSchema,
  RotateCredentialRequestSchema,
  RunEventSchema,
  RunLiveEventSchema,
  RunSchema,
  RunStepSchema,
  ScheduleSchema,
  WEBHOOK_EVENT_ID_PATTERN,
  WEBHOOK_TOKEN_PATTERN,
  WaitingReasonSchema,
  WebhookAcceptedSchema,
  WebhookSchema,
  WebhookWithTokenSchema,
} from '../src/index.js';

const uuid = () => randomUUID();
const at = '2026-11-07T12:00:00.000Z';
const person = () => ({ id: uuid(), name: 'Ana' });
const base = { organizationId: uuid(), runId: uuid(), correlationId: uuid(), at };
const node = { nodeId: 'approve_a', nodeType: 'human.approval' };

describe('flag (F7)', () => {
  it('declares triggers-enabled', () => {
    expect(FEATURE_FLAGS.triggersEnabled).toBe('triggers-enabled');
  });
});

describe('webhooks (contracts/api.openapi.yaml)', () => {
  const token = `cdw_${'A'.repeat(43)}`;

  it('recognizes the token shape and the event id', () => {
    expect(WEBHOOK_TOKEN_PATTERN.test(token)).toBe(true);
    expect(WEBHOOK_TOKEN_PATTERN.test(`cdw_${'A'.repeat(42)}`)).toBe(false);
    expect(WEBHOOK_TOKEN_PATTERN.test(`xxx_${'A'.repeat(43)}`)).toBe(false);
    expect(WEBHOOK_EVENT_ID_PATTERN.test('evt_01:ab.c-d')).toBe(true);
    expect(WEBHOOK_EVENT_ID_PATTERN.test('')).toBe(false);
    expect(WEBHOOK_EVENT_ID_PATTERN.test('a'.repeat(129))).toBe(false);
    expect(WEBHOOK_EVENT_ID_PATTERN.test('has space')).toBe(false);
    expect(WEBHOOK_EVENT_ID_PATTERN.test('slash/ed')).toBe(false);
  });

  it('answers 202 and the duplicate with the same shape', () => {
    const accepted = { runId: uuid(), status: 'queued', duplicate: false };
    expect(WebhookAcceptedSchema.parse(accepted)).toEqual(accepted);
    expect(
      WebhookAcceptedSchema.parse({ ...accepted, status: 'succeeded', duplicate: true }).duplicate,
    ).toBe(true);
    expect(WebhookAcceptedSchema.safeParse({ runId: uuid(), status: 'queued' }).success).toBe(
      false,
    );
    expect(WebhookAcceptedSchema.safeParse({ ...accepted, status: 'waiting' }).success).toBe(false);
  });

  const webhook = {
    urlBase: 'https://host.example/api/v1/hooks/0192f0a0-0000-7000-8000-000000000001/',
    generation: 1,
    generatedAt: at,
    generatedBy: person(),
    active: true,
  };

  it('describes the webhook without the token', () => {
    expect(WebhookSchema.parse(webhook)).toEqual(webhook);
    expect(WebhookSchema.safeParse({ ...webhook, generation: 0 }).success).toBe(false);
    expect(WebhookSchema.parse({ ...webhook, url: 'x' })).not.toHaveProperty('url');
  });

  it('carries the full url only in the response that creates the token', () => {
    const url = `${webhook.urlBase}${token}`;
    expect(WebhookWithTokenSchema.parse({ ...webhook, url }).url).toBe(url);
    expect(WebhookWithTokenSchema.safeParse(webhook).success).toBe(false);
  });
});

describe('schedules', () => {
  const schedule = {
    desiredState: 'scheduled',
    syncStatus: 'synced',
    cron: '0 9 * * *',
    timezone: 'America/Bogota',
    versionNumber: 3,
    lastErrorCode: null,
    nextRuns: [at],
  };

  it('describes the schedule and its sync state', () => {
    expect(ScheduleSchema.parse(schedule)).toEqual(schedule);
    expect(ScheduleSchema.safeParse({ ...schedule, syncStatus: 'unknown' }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...schedule, desiredState: 'paused' }).success).toBe(false);
  });

  it('shows at most 5 upcoming runs', () => {
    expect(ScheduleSchema.safeParse({ ...schedule, nextRuns: Array(6).fill(at) }).success).toBe(
      false,
    );
  });
});

describe('approvals', () => {
  const approval = {
    id: uuid(),
    runId: uuid(),
    workflowId: uuid(),
    workflowName: 'Refunds',
    nodeId: 'approve_a',
    nodeLabel: 'Approve refund',
    status: 'pending',
    requestedAt: at,
    expiresAt: '2026-11-08T12:00:00.000Z',
    resolvedAt: null,
    decidedBy: null,
    hasComment: false,
    canDecide: true,
  };

  it('describes a request without its message', () => {
    expect(ApprovalSchema.parse(approval)).toEqual(approval);
    expect(
      ApprovalSchema.safeParse({
        ...approval,
        status: 'approved',
        resolvedAt: at,
        decidedBy: person(),
      }).success,
    ).toBe(true);
    expect(ApprovalSchema.safeParse({ ...approval, status: 'waiting_approval' }).success).toBe(
      false,
    );
  });

  it('knows the five statuses', () => {
    for (const status of ['pending', 'approved', 'rejected', 'timed_out', 'cancelled']) {
      expect(ApprovalSchema.safeParse({ ...approval, status }).success).toBe(true);
    }
  });

  it('adds the message (max 2000) and the comment (max 500) only in the detail', () => {
    expect(ApprovalDetailSchema.parse({ ...approval, message: 'Please check' }).message).toBe(
      'Please check',
    );
    expect(ApprovalDetailSchema.safeParse({ ...approval, message: 'x'.repeat(2001) }).success).toBe(
      false,
    );
    expect(
      ApprovalDetailSchema.safeParse({ ...approval, message: 'm', comment: 'x'.repeat(501) })
        .success,
    ).toBe(false);
    expect(
      ApprovalDetailSchema.safeParse({ ...approval, message: 'm', comment: null }).success,
    ).toBe(true);
    expect(ApprovalSchema.parse({ ...approval, message: 'leak' })).not.toHaveProperty('message');
  });

  it('lists with a cursor and counts', () => {
    expect(ApprovalListSchema.parse({ items: [approval], nextCursor: null }).items).toHaveLength(1);
    expect(ApprovalCountSchema.parse({ pending: 0 })).toEqual({ pending: 0 });
    expect(ApprovalCountSchema.safeParse({ pending: -1 }).success).toBe(false);
  });

  it('reads the list query with defaults', () => {
    expect(ApprovalListQuerySchema.parse({})).toEqual({ status: 'pending', limit: 20 });
    expect(ApprovalListQuerySchema.parse({ status: 'resolved', limit: '50' })).toEqual({
      status: 'resolved',
      limit: 50,
    });
    expect(ApprovalListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(ApprovalListQuerySchema.safeParse({ status: 'all' }).success).toBe(false);
  });

  it('takes a decision with an optional comment of up to 500 characters', () => {
    expect(DecideApprovalRequestSchema.parse({ decision: 'approved' })).toEqual({
      decision: 'approved',
    });
    expect(DecideApprovalRequestSchema.parse({ decision: 'rejected', comment: 'No' }).comment).toBe(
      'No',
    );
    expect(DecideApprovalRequestSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
    expect(
      DecideApprovalRequestSchema.safeParse({ decision: 'approved', comment: 'x'.repeat(501) })
        .success,
    ).toBe(false);
    expect(DecideApprovalRequestSchema.safeParse({ decision: 'approved', extra: 1 }).success).toBe(
      false,
    );
  });

  it('defines the Update the API sends to the workflow', () => {
    expect(DECIDE_APPROVAL_UPDATE_NAME).toBe('decideApproval');
    const input = { nodeId: 'approve_a', decision: 'approved', decidedBy: uuid() };
    expect(DecideApprovalUpdateInputSchema.parse(input)).toEqual(input);
    expect(DecideApprovalUpdateInputSchema.safeParse({ ...input, nodeId: 'Bad Id' }).success).toBe(
      false,
    );
    expect(DecideApprovalUpdateResultSchema.parse({ accepted: true })).toEqual({ accepted: true });
    expect(
      DecideApprovalUpdateResultSchema.parse({ accepted: false, reason: 'already_resolved' }),
    ).toEqual({
      accepted: false,
      reason: 'already_resolved',
    });
    expect(DecideApprovalUpdateResultSchema.safeParse({ accepted: false }).success).toBe(false);
  });
});

describe('credentials', () => {
  const credential = {
    id: uuid(),
    name: 'Billing API',
    kind: 'bearer',
    headerName: null,
    createdAt: at,
    createdBy: person(),
    rotatedAt: null,
  };

  it('returns metadata and nothing else', () => {
    expect(CredentialSchema.parse(credential)).toEqual(credential);
    const parsed = CredentialSchema.parse({ ...credential, secret: 'leak', secretCt: 'leak' });
    expect(parsed).not.toHaveProperty('secret');
    expect(parsed).not.toHaveProperty('secretCt');
  });

  it('creates bearer, api_key_header and basic credentials', () => {
    expect(
      CreateCredentialRequestSchema.safeParse({ name: 'a', kind: 'bearer', secret: 's' }).success,
    ).toBe(true);
    expect(
      CreateCredentialRequestSchema.safeParse({ name: 'a', kind: 'basic', secret: 'u:p' }).success,
    ).toBe(true);
    expect(
      CreateCredentialRequestSchema.safeParse({
        name: 'a',
        kind: 'api_key_header',
        headerName: 'X-Api-Key',
        secret: 's',
      }).success,
    ).toBe(true);
    expect(
      CreateCredentialRequestSchema.safeParse({ name: 'a', kind: 'oauth', secret: 's' }).success,
    ).toBe(false);
  });

  it('requires a header name only for api_key_header', () => {
    const noHeader = CreateCredentialRequestSchema.safeParse({
      name: 'a',
      kind: 'api_key_header',
      secret: 's',
    });
    expect(noHeader.success).toBe(false);
    const extra = CreateCredentialRequestSchema.safeParse({
      name: 'a',
      kind: 'bearer',
      headerName: 'X-Api-Key',
      secret: 's',
    });
    expect(extra.success).toBe(false);
  });

  it('bounds the name and the secret', () => {
    expect(
      CreateCredentialRequestSchema.safeParse({ name: '', kind: 'bearer', secret: 's' }).success,
    ).toBe(false);
    expect(
      CreateCredentialRequestSchema.safeParse({ name: 'x'.repeat(65), kind: 'bearer', secret: 's' })
        .success,
    ).toBe(false);
    expect(
      CreateCredentialRequestSchema.safeParse({ name: 'a', kind: 'bearer', secret: '' }).success,
    ).toBe(false);
    expect(
      CreateCredentialRequestSchema.safeParse({
        name: 'a',
        kind: 'bearer',
        secret: 'x'.repeat(4097),
      }).success,
    ).toBe(false);
    expect(
      CreateCredentialRequestSchema.safeParse({
        name: 'a',
        kind: 'bearer',
        secret: 'x'.repeat(4096),
      }).success,
    ).toBe(true);
  });

  it('rotates with only the new secret', () => {
    expect(RotateCredentialRequestSchema.parse({ secret: 'new' })).toEqual({ secret: 'new' });
    expect(RotateCredentialRequestSchema.safeParse({ secret: 'new', name: 'b' }).success).toBe(
      false,
    );
    expect(RotateCredentialRequestSchema.safeParse({ secret: '' }).success).toBe(false);
  });
});

describe('http-hosts', () => {
  it('describes the entries of the allowlist and caps them at 100', () => {
    expect(HTTP_ALLOWED_HOSTS_MAX).toBe(100);
    const host = { id: uuid(), pattern: '*.partner.com', createdAt: at };
    expect(HttpAllowedHostSchema.parse(host)).toEqual(host);
    expect(HttpAllowedHostListSchema.parse({ items: [host] }).items).toHaveLength(1);
  });

  it('adds an entry by its pattern', () => {
    expect(AddHttpAllowedHostRequestSchema.parse({ pattern: 'api.example.com' })).toEqual({
      pattern: 'api.example.com',
    });
    expect(AddHttpAllowedHostRequestSchema.safeParse({ pattern: 'a.b' }).success).toBe(false); // 4 characters minimum
    expect(AddHttpAllowedHostRequestSchema.safeParse({ pattern: 'x'.repeat(254) }).success).toBe(
      false,
    );
    expect(
      AddHttpAllowedHostRequestSchema.safeParse({ pattern: 'api.example.com', port: 1 }).success,
    ).toBe(false);
  });
});

describe('Run: origin of the firing (R14)', () => {
  const run = {
    id: uuid(),
    workflowId: uuid(),
    versionNumber: 1,
    status: 'queued',
    triggeredBy: person(),
    trigger: { kind: 'manual', eventId: null, scheduledAt: null },
    rerunOf: null,
    rerunFromNodeId: null,
    correlationId: uuid(),
    error: null,
    createdAt: at,
    startedAt: null,
    finishedAt: null,
  };

  it('keeps a person as the origin of manual runs', () => {
    expect(RunSchema.parse(run).triggeredBy).toEqual(run.triggeredBy);
  });

  it('lets triggeredBy be null for webhook and schedule runs', () => {
    const webhook = {
      ...run,
      triggeredBy: null,
      trigger: { kind: 'webhook', eventId: 'evt-1', scheduledAt: null },
    };
    expect(RunSchema.parse(webhook).triggeredBy).toBeNull();
    expect(RunSchema.parse(webhook).trigger).toEqual({
      kind: 'webhook',
      eventId: 'evt-1',
      scheduledAt: null,
    });
    const scheduled = {
      ...run,
      triggeredBy: null,
      trigger: { kind: 'schedule', eventId: null, scheduledAt: at },
    };
    expect(RunSchema.parse(scheduled).trigger.kind).toBe('schedule');
  });

  it('requires the trigger and knows only three kinds', () => {
    const { trigger: _trigger, ...withoutTrigger } = run;
    expect(RunSchema.safeParse(withoutTrigger).success).toBe(false);
    expect(
      RunSchema.safeParse({ ...run, trigger: { kind: 'cron', eventId: null, scheduledAt: null } })
        .success,
    ).toBe(false);
  });
});

describe('ExecuteDagInput (F7)', () => {
  const input = {
    organizationId: uuid(),
    workflowId: uuid(),
    versionId: uuid(),
    versionNumber: 1,
    runId: uuid(),
    correlationId: uuid(),
    definition: {},
    triggerInput: {},
  };

  it('stays valid without the new fields', () => {
    expect(ExecuteDagInputSchema.safeParse(input).success).toBe(true);
  });

  it('carries the HTTP task queue, the trigger kind and the scheduled time', () => {
    const parsed = ExecuteDagInputSchema.parse({
      ...input,
      httpTaskQueue: 'cognitive-dag-http',
      triggerKind: 'schedule',
      scheduledAt: at,
    });
    expect(parsed).toMatchObject({
      httpTaskQueue: 'cognitive-dag-http',
      triggerKind: 'schedule',
      scheduledAt: at,
    });
  });

  it('refuses invalid values', () => {
    expect(ExecuteDagInputSchema.safeParse({ ...input, httpTaskQueue: '' }).success).toBe(false);
    expect(ExecuteDagInputSchema.safeParse({ ...input, triggerKind: 'cron' }).success).toBe(false);
    expect(ExecuteDagInputSchema.safeParse({ ...input, scheduledAt: 'yesterday' }).success).toBe(
      false,
    );
  });
});

describe('run events of the approvals (F7)', () => {
  it('requests an approval with its label and deadline', () => {
    const event = {
      ...base,
      transition: 'approval.requested',
      ...node,
      nodeLabel: 'Approve refund',
      expiresAt: '2026-11-08T12:00:00.000Z',
    };
    expect(RunEventSchema.parse(event)).toEqual(event);
    expect(RunEventSchema.safeParse({ ...event, nodeLabel: '' }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...event, nodeLabel: 'x'.repeat(101) }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...event, expiresAt: 'soon' }).success).toBe(false);
  });

  it('never carries the message or the comment', () => {
    const parsed = RunEventSchema.parse({
      ...base,
      transition: 'approval.requested',
      ...node,
      nodeLabel: 'Approve',
      expiresAt: at,
      message: 'secret text',
    });
    expect(parsed).not.toHaveProperty('message');
    const resolved = RunEventSchema.parse({
      ...base,
      transition: 'approval.resolved',
      ...node,
      outcome: 'approved',
      decidedBy: uuid(),
      hasComment: true,
      comment: 'secret comment',
    });
    expect(resolved).not.toHaveProperty('comment');
  });

  it('resolves with a decider for approved and rejected', () => {
    for (const outcome of ['approved', 'rejected']) {
      const event = {
        ...base,
        transition: 'approval.resolved',
        ...node,
        outcome,
        hasComment: false,
      };
      expect(RunEventSchema.safeParse(event).success).toBe(false);
      expect(RunEventSchema.safeParse({ ...event, decidedBy: uuid() }).success).toBe(true);
    }
  });

  it('resolves without a decider for timed_out and cancelled', () => {
    for (const outcome of ['timed_out', 'cancelled']) {
      const event = {
        ...base,
        transition: 'approval.resolved',
        ...node,
        outcome,
        hasComment: false,
      };
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expect(RunEventSchema.safeParse({ ...event, decidedBy: uuid() }).success).toBe(false);
      expect(RunEventSchema.safeParse({ ...event, hasComment: true }).success).toBe(false);
    }
  });

  it('refuses an unknown outcome', () => {
    expect(
      RunEventSchema.safeParse({
        ...base,
        transition: 'approval.resolved',
        ...node,
        outcome: 'maybe',
        hasComment: false,
      }).success,
    ).toBe(false);
  });

  it('keeps the previous transitions', () => {
    expect(
      RunEventSchema.safeParse({
        ...base,
        transition: 'step.running',
        nodeId: 'a',
        nodeType: 'mock.service',
      }).success,
    ).toBe(true);
  });
});

describe('waiting reasons of a step (F7)', () => {
  it('adds approval and circuit_open', () => {
    expect(WaitingReasonSchema.options).toEqual(['rate_limited', 'approval', 'circuit_open']);
  });

  it('reaches the step and the live event', () => {
    const step = {
      nodeId: 'approve_a',
      nodeType: 'human.approval',
      status: 'running',
      attempts: 0,
      startedAt: at,
      finishedAt: null,
      durationMs: null,
      error: null,
      waitingReason: 'approval',
    };
    expect(RunStepSchema.parse(step).waitingReason).toBe('approval');
    expect(RunStepSchema.safeParse({ ...step, waitingReason: 'circuit_open' }).success).toBe(true);
    const live = {
      runId: uuid(),
      correlationId: uuid(),
      transition: 'step.running',
      at,
      waitingReason: 'circuit_open',
    };
    expect(RunLiveEventSchema.parse(live).waitingReason).toBe('circuit_open');
  });
});

describe('problem codes (F7)', () => {
  const codes = [
    'WEBHOOK_TOKEN_INVALID',
    'WEBHOOK_TIMESTAMP_INVALID',
    'WEBHOOK_EVENT_ID_INVALID',
    'WEBHOOK_NOT_ACTIVE',
    'WEBHOOK_RATE_LIMITED',
    'SCHEDULE_LIMIT_REACHED',
    'APPROVAL_SELF_DECISION_FORBIDDEN',
    'APPROVAL_ALREADY_RESOLVED',
    'APPROVAL_CONTENT_EXPIRED',
    'CREDENTIAL_NAME_TAKEN',
    'CREDENTIAL_ARCHIVED',
    'CREDENTIAL_NOT_FOUND',
    'CREDENTIALS_NOT_CONFIGURED',
    'HTTP_HOST_EXISTS',
    'HTTP_HOST_LIMIT_REACHED',
  ];

  it.each(codes)('knows %s', (code) => {
    expect(ProblemCodeSchema.safeParse(code).success).toBe(true);
  });

  it('allows Retry-After on a rate limited webhook only among the new codes', () => {
    const problem = (code: string) => ({
      status: 429,
      title: 'Too Many Requests',
      detail: 'Demasiadas peticiones.',
      code,
      correlationId: uuid(),
      retryAfterSeconds: 3,
    });
    expect(ProblemDetailsSchema.safeParse(problem('WEBHOOK_RATE_LIMITED')).success).toBe(true);
    expect(ProblemDetailsSchema.safeParse(problem('WEBHOOK_NOT_ACTIVE')).success).toBe(false);
  });

  it('lists the error codes an http.request step can record', () => {
    expect([...HTTP_STEP_ERROR_CODES].sort()).toEqual(
      [
        'SSRF_BLOCKED_ADDRESS',
        'HTTP_HOST_NOT_ALLOWED',
        'HTTP_REDIRECT_NOT_ALLOWED',
        'HTTP_TOO_MANY_REDIRECTS',
        'HTTP_RESPONSE_TOO_LARGE',
        'HTTP_CONTENT_TYPE_UNSUPPORTED',
        'HTTP_URL_INVALID',
        'HTTP_HEADER_FORBIDDEN',
        'HTTP_TLS_ERROR',
        'HTTP_NETWORK_ERROR',
        'HTTP_TIMEOUT',
        'HTTP_CIRCUIT_OPEN',
        'HTTP_DISABLED',
        'CREDENTIAL_UNAVAILABLE',
      ].sort(),
    );
  });
});
