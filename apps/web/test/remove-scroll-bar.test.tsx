import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoveScrollBar } from '../src/lib/remove-scroll-bar';

describe('scroll lock without an injected style (CSP style-src self)', () => {
  afterEach(() => document.body.removeAttribute('data-scroll-locked'));

  it('marks the body while an overlay is open and counts nested overlays', () => {
    const first = render(<RemoveScrollBar />);
    expect(document.body.getAttribute('data-scroll-locked')).toBe('1');
    const second = render(<RemoveScrollBar />);
    expect(document.body.getAttribute('data-scroll-locked')).toBe('2');
    second.unmount();
    expect(document.body.getAttribute('data-scroll-locked')).toBe('1');
    first.unmount();
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
  });

  it('adds no <style> element to the document', () => {
    const before = document.querySelectorAll('style').length;
    render(<RemoveScrollBar />);
    expect(document.querySelectorAll('style').length).toBe(before);
  });
});
