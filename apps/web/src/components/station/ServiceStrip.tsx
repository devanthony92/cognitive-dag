import { useQuery } from '@tanstack/react-query';
import { memo, useEffect, useRef, useState } from 'react';
import type { RunDetail } from '@cognitive-dag/contracts';
import { cn } from '../../lib/utils';
import { runQuery } from '../../features/runs/api';
import { toEditableDefinition } from '../../features/workflows/model';
import { serviceStateOf, statusLabelOf } from '../status/service-state';
import { STATE_TEXT_CLASS, StatusGlyph, type ServiceState } from '../status/statusGlyphs';

export interface StripStation {
  nodeId: string;
  label: string;
  state: ServiceState;
  stateLabel: string;
}

/** One station per step, in the order of the definition; a step that has not started is pending. */
export function stripStations(detail: RunDetail): StripStation[] {
  const steps = new Map(detail.steps.map((step) => [step.nodeId, step]));
  return toEditableDefinition(detail.definition).definition.nodes.map((node) => {
    const step = steps.get(node.id);
    const subject = {
      kind: 'step' as const,
      status: step?.status ?? ('pending' as const),
      waitingReason: step?.waitingReason ?? null,
    };
    return {
      nodeId: node.id,
      label: node.label,
      state: serviceStateOf(subject),
      stateLabel: statusLabelOf(subject),
    };
  });
}

/** One station of the strip; only a station whose own values change is redrawn. */
export const StripStationMark = memo(
  function StripStationMark({ station }: { station: StripStation }) {
    return (
      <li className="flex items-center">
        <span
          data-strip-station
          data-state={station.state}
          className={cn('flex size-6 items-center justify-center', STATE_TEXT_CLASS[station.state])}
        >
          <StatusGlyph state={station.state} />
          <span className="sr-only">{`${station.label}: ${station.stateLabel}`}</span>
        </span>
      </li>
    );
  },
  (a, b) =>
    a.station.nodeId === b.station.nodeId &&
    a.station.state === b.station.state &&
    a.station.label === b.station.label &&
    a.station.stateLabel === b.station.stateLabel,
);

/**
 * The service strip of a run: a station per step with the glyph of its state. With more than `max`
 * steps the tail folds into «+N». While the detail loads (`stations` undefined) a placeholder of the
 * same height holds the space, so the row does not jump.
 */
export function ServiceStrip({
  stations,
  max = 8,
}: {
  stations: readonly StripStation[] | undefined;
  max?: number;
}) {
  if (!stations) {
    return (
      <span
        data-strip-placeholder
        aria-busy="true"
        className="block h-6 w-32 animate-pulse rounded-station bg-raised motion-reduce:animate-none"
      />
    );
  }
  const folded = stations.length > max;
  const shown = folded ? stations.slice(0, max - 1) : stations;
  const rest = stations.length - shown.length;
  return (
    <ul aria-label="Tira de servicio" className="flex h-6 items-center gap-0.5">
      {shown.map((station) => (
        <StripStationMark key={station.nodeId} station={station} />
      ))}
      {folded && (
        <li className="px-1 text-label font-semibold text-ink-muted tabular">
          <span aria-hidden="true">{`+${rest}`}</span>
          <span className="sr-only">{`y ${rest} pasos más`}</span>
        </li>
      )}
    </ul>
  );
}

/** Runs at most `size` tasks at once; the rest wait their turn. */
export function createLimiter(size: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    running -= 1;
    queue.shift()?.();
  };
  return <T,>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        running += 1;
        task().then(resolve, reject).finally(next);
      };
      if (running < size) start();
      else queue.push(start);
    });
}

/** At most 8 detail requests for strips at the same time, in the whole page. */
const limit = createLimiter(8);

/**
 * The strip of a list row: asks for the detail of the run only once the row is on screen (research
 * R15: the list carries no steps). A finished run never changes, so it is cached for good; a live one
 * is refreshed after 30 s.
 */
export function LazyServiceStrip({
  organizationId,
  runId,
  final,
}: {
  organizationId: string;
  runId: string;
  final: boolean;
}) {
  const holder = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = holder.current;
    if (!element || visible || typeof IntersectionObserver === 'undefined') {
      if (typeof IntersectionObserver === 'undefined') setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  const base = runQuery(organizationId, runId);
  const detail = useQuery({
    ...base,
    queryFn: (context) => limit(() => base.queryFn!(context)),
    enabled: visible,
    staleTime: final ? Infinity : 30_000,
  });
  return (
    <span ref={holder} className="inline-block">
      <ServiceStrip stations={detail.data ? stripStations(detail.data) : undefined} />
    </span>
  );
}
