import { defaultPayloadConverter } from '@temporalio/common';
import { describe, expect, it } from 'vitest';
import { stepContentOf } from '../../src/runs/run-content';

const payload = (value: unknown) => ({ payloads: [defaultPayloadConverter.toPayload(value)] });

function llmEvents(activity: string, nodeId: string, result: unknown) {
  return [
    {
      eventId: 5,
      activityTaskScheduledEventAttributes: {
        activityType: { name: activity },
        input: payload({
          runId: 'r',
          nodeId,
          config: { text: 'hola', labels: ['a', 'b'] },
          prompt: 'SECRET PROMPT',
        }),
      },
    },
    {
      eventId: 7,
      activityTaskCompletedEventAttributes: { scheduledEventId: 5, result: payload(result) },
    },
  ];
}

describe('stepContentOf for LLM nodes', () => {
  it.each([
    ['llm.classify', 'llmClassify'],
    ['llm.extract', 'llmExtract'],
    ['llm.generate', 'llmGenerate'],
  ])('reads %s from the %s activity: config as input, the output as output', (type, activity) => {
    const output = { label: 'a', confidence: 0.9 };
    const events = llmEvents(activity, 'n1', { output, attempts: 1 });
    expect(stepContentOf(events, { id: 'n1', type })).toEqual({
      input: { config: { text: 'hola', labels: ['a', 'b'] } },
      output,
    });
  });

  it('never returns anything of the payload but the config', () => {
    const events = llmEvents('llmClassify', 'n1', { output: {}, attempts: 1 });
    const content = stepContentOf(events, { id: 'n1', type: 'llm.classify' });
    expect(JSON.stringify(content)).not.toContain('SECRET PROMPT');
  });

  it('does not mix up nodes or activities', () => {
    const events = llmEvents('llmClassify', 'n1', { output: {}, attempts: 1 });
    expect(stepContentOf(events, { id: 'n2', type: 'llm.classify' })).toEqual({});
    expect(stepContentOf(events, { id: 'n1', type: 'llm.generate' })).toEqual({});
  });
});
