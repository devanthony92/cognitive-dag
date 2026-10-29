import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createWorkerId } from '../../src/worker';

describe('createWorkerId', () => {
  it('is opaque and unique per call', () => {
    const id = createWorkerId();
    expect(id).toMatch(/^worker-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id).not.toContain(hostname());
    expect(createWorkerId()).not.toBe(id);
  });
});
