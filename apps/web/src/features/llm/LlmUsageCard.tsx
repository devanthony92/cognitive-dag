import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../lib/utils';
import { ProblemAlert } from '../auth/ProblemAlert';
import { llmUsageQuery } from './api';
import { formatCostUsd, formatTokens } from './format';

/** The meter is 20 fixed segments of 5 % each, so it needs no dynamic width. */
const SEGMENTS = 20;
const SEGMENT_INDEXES = Array.from({ length: SEGMENTS }, (_, index) => index);

/**
 * "Consumo LLM de hoy" (F5, research R12): tokens used of the daily limit and estimated cost.
 */
export function LlmUsageCard({ organizationId }: { organizationId: string }) {
  const usage = useQuery(llmUsageQuery(organizationId));

  const body = () => {
    if (usage.isPending) {
      return (
        <div role="status" className="grid gap-3">
          <span className="sr-only">Cargando consumo</span>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-5 w-48" />
        </div>
      );
    }
    if (usage.isError) return <ProblemAlert error={usage.error} />;
    const { tokensUsed, tokensLimit, costMicroUsd } = usage.data;
    if (tokensUsed === 0 && costMicroUsd === 0) {
      return <p className="text-body-sm text-ink-muted">Sin consumo hoy</p>;
    }
    const percent = Math.min(100, Math.round((tokensUsed / tokensLimit) * 100));
    const filled = Math.round((percent / 100) * SEGMENTS);
    const nearLimit = percent >= 90;
    return (
      <div className="grid gap-3">
        <p className="text-body">
          <span className="text-title font-semibold text-ink">{formatTokens(tokensUsed)}</span>
          <span className="text-ink-muted"> de {formatTokens(tokensLimit)} tokens</span>
        </p>
        <div
          role="progressbar"
          aria-label="Tokens usados hoy"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${percent} % del límite diario`}
          className="grid h-3 w-full auto-cols-fr grid-flow-col gap-0.5"
        >
          {SEGMENT_INDEXES.map((index) => (
            <span
              key={index}
              className={cn(
                'rounded-sm',
                index < filled ? (nearLimit ? 'bg-state-failed' : 'bg-action') : 'bg-raised',
              )}
            />
          ))}
        </div>
        <p className="text-body-sm text-ink-muted">
          {percent} % del límite diario{nearLimit ? ' · cerca del límite' : ''}
        </p>
        <p className="text-body-sm text-ink-muted">
          Costo estimado: <span className="text-ink">{formatCostUsd(costMicroUsd)}</span>
        </p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consumo LLM de hoy</CardTitle>
        <CardDescription>
          Día UTC. El límite diario lo fija el operador de la plataforma.
        </CardDescription>
      </CardHeader>
      <CardContent>{body()}</CardContent>
    </Card>
  );
}
