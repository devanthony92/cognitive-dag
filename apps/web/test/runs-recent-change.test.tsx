/**
 * A run that changes state stands out (F10, FR-028, T059; research R11): its row stays highlighted
 * until it receives the focus or 8 s pass, and with reduced motion the highlight appears and goes
 * without any transition.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENT_CHANGE_MS, useRecentChange } from '../src/components/station/useRecentChange';
import { REDUCED_MOTION, stubMedia } from './media';

function Row({ status }: { status: string }) {
  const recent = useRecentChange(status);
  return (
    <div
      tabIndex={0}
      data-testid="row"
      data-recent={recent.changed ? 'true' : undefined}
      className={recent.className}
      onFocus={recent.onFocus}
    >
      {status}
    </div>
  );
}

const row = () => screen.getByTestId('row');

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('recent change of a row', () => {
  it('does not highlight what was already there', () => {
    render(<Row status="running" />);
    expect(row().getAttribute('data-recent')).toBeNull();
  });

  it('highlights a row whose state changed for 8 s', async () => {
    expect(RECENT_CHANGE_MS).toBe(8000);
    const { rerender } = render(<Row status="running" />);
    rerender(<Row status="succeeded" />);
    expect(row().getAttribute('data-recent')).toBe('true');
    expect(row().className).toMatch(/\bbg-raised\b/);

    await act(() => vi.advanceTimersByTimeAsync(7999));
    expect(row().getAttribute('data-recent')).toBe('true');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(row().getAttribute('data-recent')).toBeNull();
  });

  it('stops highlighting when the row receives the focus', () => {
    const { rerender } = render(<Row status="running" />);
    rerender(<Row status="failed" />);
    fireEvent.focus(row());
    expect(row().getAttribute('data-recent')).toBeNull();
  });

  it('starts the 8 s again when it changes once more', async () => {
    const { rerender } = render(<Row status="queued" />);
    rerender(<Row status="running" />);
    await act(() => vi.advanceTimersByTimeAsync(6000));
    rerender(<Row status="succeeded" />);
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(row().getAttribute('data-recent')).toBe('true');
  });

  it('fades the highlight only when motion is welcome', () => {
    const { rerender } = render(<Row status="running" />);
    rerender(<Row status="succeeded" />);
    expect(row().className).toMatch(/transition-colors/);
  });

  it('uses no transition at all with reduced motion', () => {
    stubMedia(REDUCED_MOTION);
    const { rerender } = render(<Row status="running" />);
    rerender(<Row status="succeeded" />);
    expect(row().getAttribute('data-recent')).toBe('true');
    expect(row().className).not.toMatch(/transition|animate/);
  });
});
