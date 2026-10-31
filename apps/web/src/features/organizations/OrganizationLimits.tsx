import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { featuresQuery, isDagEditorEnabled, isExecutionEnabled } from '../flags';
import { limitsQuery } from '../workflows/api';

const formatBytes = (bytes: number): string => {
  const kb = bytes / 1024;
  return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
};

/**
 * Size limits that apply to the DAGs of the organization (FR-021). Every member sees them; nobody
 * can change them here — only the platform operator, with the administration script. That is why
 * this card has no inputs and no buttons.
 */
export function OrganizationLimits({ organizationId }: { organizationId: string }) {
  const features = useQuery(featuresQuery);
  const enabled = isDagEditorEnabled(features.data);
  const limits = useQuery({ ...limitsQuery(organizationId), enabled });

  if (!enabled || !limits.data) return null;
  const { maxNodes, maxEdges, maxDefinitionBytes, maxConcurrentRuns, source } = limits.data;

  const rows: Array<[string, string]> = [
    ['Nodos por workflow', String(maxNodes)],
    ['Conexiones por workflow', String(maxEdges)],
    ['Tamaño de la definición', formatBytes(maxDefinitionBytes)],
  ];
  if (isExecutionEnabled(features.data)) {
    rows.push(['Ejecuciones simult�neas', String(maxConcurrentRuns)]);
  }

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
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {rows.map(([name, value]) => (
            <div key={name} className="rounded-md border p-3">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
