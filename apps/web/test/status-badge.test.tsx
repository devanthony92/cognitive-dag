import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ErrorClassSchema,
  RunStatusSchema,
  StepStatusSchema,
  WaitingReasonSchema,
  type ErrorClass,
} from '@cognitive-dag/contracts';
import { StatusBadge, StatusMark } from '../src/components/status/StatusBadge';
import { serviceStateOf, type ServiceState } from '../src/components/status/service-state';
import {
  SERVICE_STATES,
  STATE_TEXT_CLASS,
  StatusGlyph,
} from '../src/components/status/statusGlyphs';
import {
  ERROR_CLASS_LABELS,
  RUN_STATUS_LABELS,
  STEP_STATUS_LABELS,
  WAITING_REASON_LABELS,
} from '../src/features/runs/status';

afterEach(cleanup);

const glyphMarkup = (state: ServiceState, variant: 'ring' | 'bare') => {
  const { container, unmount } = render(<StatusGlyph state={state} variant={variant} />);
  const markup = container.innerHTML;
  unmount();
  return markup;
};

describe('service states (design contract §1)', () => {
  it('has the 7 design states plus Pendiente', () => {
    expect([...SERVICE_STATES].sort()).toEqual(
      [
        'cancelled',
        'failed',
        'pending',
        'reused',
        'running',
        'skipped',
        'succeeded',
        'waiting',
      ].sort(),
    );
  });

  it('gives every state a distinct glyph, in the badge and in the 18 px mark', () => {
    for (const variant of ['ring', 'bare'] as const) {
      const markups = SERVICE_STATES.map((state) => glyphMarkup(state, variant));
      expect(new Set(markups).size).toBe(SERVICE_STATES.length);
    }
  });

  it('hides each glyph from assistive technology and draws it with the token of its state', () => {
    for (const state of SERVICE_STATES) {
      const { container, unmount } = render(<StatusGlyph state={state} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('data-state')).toBe(state);
      expect(STATE_TEXT_CLASS[state]).toMatch(/^text-(state-[a-z]+|ink-muted)$/);
      unmount();
    }
    expect(STATE_TEXT_CLASS.pending).toBe('text-ink-muted');
    expect(STATE_TEXT_CLASS.waiting).toBe('text-state-waiting');
  });

  it('maps every StepStatus and RunStatus to a state', () => {
    const steps: Record<string, ServiceState> = {
      pending: 'pending',
      running: 'running',
      succeeded: 'succeeded',
      failed: 'failed',
      skipped: 'skipped',
      cancelled: 'cancelled',
      reused: 'reused',
    };
    expect([...StepStatusSchema.options].sort()).toEqual(Object.keys(steps).sort());
    for (const status of StepStatusSchema.options) {
      expect(serviceStateOf({ kind: 'step', status })).toBe(steps[status]);
    }
    const runs: Record<string, ServiceState> = {
      queued: 'waiting',
      running: 'running',
      succeeded: 'succeeded',
      failed: 'failed',
      cancelled: 'cancelled',
      timed_out: 'failed',
    };
    expect([...RunStatusSchema.options].sort()).toEqual(Object.keys(runs).sort());
    for (const status of RunStatusSchema.options) {
      expect(serviceStateOf({ kind: 'run', status })).toBe(runs[status]);
    }
  });

  it('turns any waiting reason into Esperando with the existing text', () => {
    for (const waitingReason of WaitingReasonSchema.options) {
      expect(serviceStateOf({ kind: 'step', status: 'running', waitingReason })).toBe('waiting');
      const { unmount } = render(
        <StatusBadge kind="step" status="running" waitingReason={waitingReason} />,
      );
      expect(screen.getByText(WAITING_REASON_LABELS[waitingReason])).toBeDefined();
      unmount();
    }
  });
});

describe('StatusBadge', () => {
  it('shows glyph + Spanish label for every step and run status', () => {
    for (const status of StepStatusSchema.options) {
      const { container, unmount } = render(<StatusBadge kind="step" status={status} />);
      expect(screen.getByText(STEP_STATUS_LABELS[status])).toBeDefined();
      expect(container.querySelector('svg[data-state]')).not.toBeNull();
      unmount();
    }
    for (const status of RunStatusSchema.options) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(RUN_STATUS_LABELS[status])).toBeDefined();
      expect(container.querySelector('svg[data-state]')).not.toBeNull();
      unmount();
    }
  });

  it('is a 24 px pill', () => {
    const { container } = render(<StatusBadge status="succeeded" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('h-6');
    expect(badge.className).toContain('rounded-station');
  });

  it('shows the error class of a failure as text', () => {
    for (const errorClass of ErrorClassSchema.options as readonly ErrorClass[]) {
      const { unmount } = render(
        <StatusBadge kind="step" status="failed" errorClass={errorClass} />,
      );
      expect(screen.getByText('Fallido')).toBeDefined();
      expect(screen.getByText(ERROR_CLASS_LABELS[errorClass].label)).toBeDefined();
      unmount();
    }
  });

  it('shows a timed-out run as Vencida with the class Tiempo agotado', () => {
    render(<StatusBadge status="timed_out" />);
    expect(screen.getByText('Vencida')).toBeDefined();
    expect(screen.getByText(ERROR_CLASS_LABELS.timeout.label)).toBeDefined();
  });

  it('spins En curso only when motion is allowed', () => {
    const { container } = render(<StatusBadge kind="step" status="running" />);
    const classes = (container.querySelector('svg')?.getAttribute('class') ?? '').split(/\s+/);
    expect(classes).toContain('motion-safe:animate-spin-slow');
    expect(classes.filter((name) => /^animate-/.test(name))).toEqual([]);
  });
});

describe('StatusMark (18 px badge of a station)', () => {
  it('is an 18 px circle with the label for assistive technology', () => {
    const { container } = render(<StatusMark state="succeeded" label="Completado" />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.className).toContain('size-[18px]');
    expect(mark.className).toContain('rounded-station');
    expect(mark.className).toContain('border-2');
    expect(mark.className).toContain('border-ground');
    expect(screen.getByText('Completado').className).toContain('sr-only');
  });
});
