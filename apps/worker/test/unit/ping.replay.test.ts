import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';

const workflowsPath = path.resolve(__dirname, '../../src/workflows');
const historyPath = path.resolve(__dirname, '../histories/ping-completed.json');

describe('pingWorkflow replay', () => {
  it('replays the recorded history without non-determinism errors', async () => {
    const history: unknown = JSON.parse(readFileSync(historyPath, 'utf8'));
    await expect(Worker.runReplayHistory({ workflowsPath }, history)).resolves.toBeUndefined();
  });
});
