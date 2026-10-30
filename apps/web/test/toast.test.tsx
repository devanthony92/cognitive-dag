import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../src/components/ui/toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('closes itself after its duration', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast message="Hecho" duration={3000} onClose={onClose} />);

    expect(screen.getByText('Hecho')).toBeDefined();
    void act(() => vi.advanceTimersByTime(2999));
    expect(onClose).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(2));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
