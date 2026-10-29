import { describe, expect, it } from 'vitest';
import { progressiveDelaySeconds } from '../../src/rate-limit/progressive';

describe('progressiveDelaySeconds', () => {
  it.each([0, 1, 2, 3, 4])('imposes no wait up to the 4th failure (%i)', (failures) => {
    expect(progressiveDelaySeconds(failures)).toBe(0);
  });

  it('starts at 1 second on the 5th failure and doubles each time', () => {
    expect([5, 6, 7, 8, 9].map(progressiveDelaySeconds)).toEqual([1, 2, 4, 8, 16]);
  });

  it('caps at 15 minutes', () => {
    expect(progressiveDelaySeconds(14)).toBe(512);
    expect(progressiveDelaySeconds(15)).toBe(900);
    expect(progressiveDelaySeconds(1000)).toBe(900);
  });
});
