import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { ProblemAlert } from '../auth/ProblemAlert';
import { llmUsageQuery } from './api';
import { formatCostUsd, formatTokens } from './format';

/**
 * "Consumo LLM de hoy" (F5, research R12): tokens used of the daily limit and estimated cost.
 */
export function LlmUsageCard({ organizationId }: { organizationId: string }) {
  const usage = useQuery(llmUsageQuery(organizationId));

  const body = () => {
    if (usage.isPending) {
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando consumo…
        </p>
      );
    }
    if (usage.isError) return <ProblemAlert error={usage.error} />;
    const { tokensUsed, tokensLimit, costMicroUsd } = usage.data;
    if (tokensUsed === 0 && costMicroUsd === 0) {
      return <p className="text-sm text-muted-foreground">Sin consumo hoy</p>;
    }
    const percent = Math.min(100, Math.round((tokensUsed / tokensLimit) * 100));
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          <span className="text-lg font-semibold">{formatTokens(tokensUsed)}</span>
          <span className="text-muted-foreground"> de {formatTokens(tokensLimit)} tokens</span>
        </p>
        <div
          role="progressbar"
          aria-label="Tokens usados hoy"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${percent} % del límite diario`}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={percent >= 90 ? 'h-full bg-destructive' : 'h-full bg-primary'}
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Costo estimado: <span className="text-foreground">{formatCostUsd(costMicroUsd)}</span>
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
