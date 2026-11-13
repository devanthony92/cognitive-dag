import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { limitsQuery } from '../workflows/api';

const formatBytes = (bytes: number): string => {
  const kb = bytes / 1024;
  return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
};

/** The shape of the card while the limits load, announced as a status. */
function LimitsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="w-full">
      <span className="sr-only">Cargando límites de los workflows</span>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Size limits that apply to the DAGs of the organization (FR-021). Every member sees them; nobody
 * can change them here — only the platform operator, with the administration script. That is why
 * this card has no inputs and no buttons.
 */
export function OrganizationLimits({ organizationId }: { organizationId: string }) {
  const limits = useQuery(limitsQuery(organizationId));

  if (limits.isPending) return <LimitsSkeleton />;
  if (!limits.data) return null;
  const { maxNodes, maxEdges, maxDefinitionBytes, maxConcurrentRuns, source } = limits.data;

  const rows: Array<[string, string]> = [
    ['Nodos por workflow', String(maxNodes)],
    ['Conexiones por workflow', String(maxEdges)],
    ['Tamaño de la definición', formatBytes(maxDefinitionBytes)],
    ['Ejecuciones simultáneas', String(maxConcurrentRuns)],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Límites de los workflows</CardTitle>
        <CardDescription>
          {source === 'organization'
            ? 'Límites propios de esta organización.'
            : 'Límites por defecto de la plataforma.'}{' '}
          Los fija el operador de la plataforma; no se pueden cambiar desde la aplicación.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-body-sm sm:grid-cols-2">
          {rows.map(([name, value]) => (
            <div key={name} className="rounded-md border border-line p-3">
              <dt className="text-ink-muted">{name}</dt>
              <dd className="text-title font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
