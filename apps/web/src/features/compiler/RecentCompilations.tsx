import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { ProblemAlert } from '../auth/ProblemAlert';
import { compilationsQuery } from './api';
import { STATUS_LABEL } from './messages';

interface Props {
  organizationId: string;
  workflowId?: string | undefined;
  selectedId: string | undefined;
  onSelect: (compilationId: string) => void;
}

/** The last 20 compilations (of the workflow, when regenerating); they survive closing the page. */
export function RecentCompilations({ organizationId, workflowId, selectedId, onSelect }: Props) {
  const list = useQuery(compilationsQuery(organizationId, workflowId));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compilaciones recientes</CardTitle>
        <CardDescription>
          {workflowId === undefined
            ? 'Las últimas de la organización.'
            : 'Las últimas de este workflow.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {list.isPending && (
          <div role="status" className="grid gap-2">
            <span className="sr-only">Cargando compilaciones…</span>
            <Skeleton className="h-13 w-full" />
            <Skeleton className="h-13 w-full" />
            <Skeleton className="h-13 w-full" />
          </div>
        )}
        {list.isError && <ProblemAlert error={list.error} />}
        {list.data?.length === 0 && (
          <EmptyState
            titleAs="h3"
            title="Todavía no hay compilaciones."
            description="Describe lo que quieres automatizar y aparecerá aquí."
          />
        )}
        {list.data && list.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Modo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead numeric>Nodos</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((item) => (
                <TableRow
                  key={item.id}
                  data-state={item.id === selectedId ? 'selected' : undefined}
                >
                  <TableCell>{new Date(item.createdAt).toLocaleString('es')}</TableCell>
                  <TableCell>{item.mode === 'regenerate' ? 'Regenerar' : 'Nuevo'}</TableCell>
                  <TableCell>{STATUS_LABEL[item.status]}</TableCell>
                  <TableCell numeric>{item.nodeCount ?? '—'}</TableCell>
                  <TableCell>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-pressed={item.id === selectedId}
                      onClick={() => onSelect(item.id)}
                    >
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
