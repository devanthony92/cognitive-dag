import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
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
          <p role="status" className="text-sm text-muted-foreground">
            Cargando compilaciones…
          </p>
        )}
        {list.isError && <ProblemAlert error={list.error} />}
        {list.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Todavía no hay compilaciones.</p>
        )}
        {list.data && list.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Modo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Nodos</TableHead>
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
                  <TableCell>{item.nodeCount ?? '—'}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
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
