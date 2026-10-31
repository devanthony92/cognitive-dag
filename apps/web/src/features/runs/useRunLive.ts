import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  RunStreamEventSchema,
  type RunDetail,
  type RunStep,
  type RunStreamEvent,
} from '@cognitive-dag/contracts';
import { runEventsUrl, runKey } from './api';

const POLL_MS = 2000;

export type LiveMode = 'connecting' | 'live' | 'polling' | 'idle';

function applyEvent(detail: RunDetail, event: RunStreamEvent): RunDetail {
  if (event.type === 'snapshot') return { ...detail, ...event.run, steps: event.steps };
  if (event.type === 'run') return { ...detail, ...event.run };
  const known = detail.steps.some((step) => step.nodeId === event.step.nodeId);
  const steps: RunStep[] = known
    ? detail.steps.map((step) => (step.nodeId === event.step.nodeId ? event.step : step))
    : [...detail.steps, event.step];
  return { ...detail, steps };
}

/**
 * Follows a run in progress over Server-Sent Events and writes every event into the run query.
 * Each event carries the state after the change, so repeating one is harmless. When the stream
 * fails the hook reports `polling` and refetches the run until the browser
 * reconnects (the first event after a reconnection is a full snapshot). Stops when
 * `active` turns false, i.e. the run reached a final state.
 */
export function useRunLive(organizationId: string, runId: string, active: boolean): LiveMode {
  const queryClient = useQueryClient();
  const supported = typeof EventSource !== 'undefined';
  const [mode, setMode] = useState<LiveMode>('connecting');

  useEffect(() => {
    if (!active) return;
    if (!supported) {
      setMode('polling');
      return;
    }
    setMode('connecting');
    const source = new EventSource(runEventsUrl(organizationId, runId), { withCredentials: true });
    const onEvent = (message: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data);
      } catch {
        return;
      }
      const event = RunStreamEventSchema.safeParse(parsed);
      if (!event.success) return;
      setMode('live');
      queryClient.setQueryData<RunDetail>(runKey(organizationId, runId), (current) =>
        current ? applyEvent(current, event.data) : current,
      );
    };
    for (const type of ['snapshot', 'run', 'step'] as const) {
      source.addEventListener(type, onEvent as EventListener);
    }
    source.onopen = () => setMode('live');
    // EventSource reconnects by itself; meanwhile the page polls so no state is lost.
    source.onerror = () => setMode('polling');
    return () => source.close();
  }, [active, supported, organizationId, runId, queryClient]);

  // Fallback: while the stream is down, look at the run every few seconds.
  useEffect(() => {
    if (!active || mode !== 'polling') return;
    const key = runKey(organizationId, runId);
    const timer = setInterval(() => void queryClient.refetchQueries({ queryKey: key }), POLL_MS);
    return () => clearInterval(timer);
  }, [active, mode, organizationId, runId, queryClient]);

  return active ? mode : 'idle';
}

/** Re-renders every second while `active`, for durations that are still counting. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
