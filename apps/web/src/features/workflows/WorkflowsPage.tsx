import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { CreateWorkflowRequestSchema, type WorkflowBody } from '@cognitive-dag/contracts';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../components/ui/form';
import { EmptyState } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { RowsSkeleton } from '../../components/ui/rows-skeleton';
import { STACKED } from '../../components/ui/table-stacked';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/utils';
import { ProblemAlert } from '../auth/ProblemAlert';
import { sessionQuery } from '../session/session';
import { createWorkflow, workflowsKey, workflowsQuery } from './api';

type CreateInput = z.input<typeof CreateWorkflowRequestSchema>;
type CreateOutput = z.output<typeof CreateWorkflowRequestSchema>;

/** Workflows of the organization. Owners and editors create them; viewers only open them. */
export function WorkflowsPage({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useQuery(sessionQuery);
  const role = session.data?.organizations.find((item) => item.id === organizationId)?.role;
  const canCreate = role === 'owner' || role === 'editor';
  const workflows = useQuery(workflowsQuery(organizationId));

  const form = useForm<CreateInput, unknown, CreateOutput>({
    resolver: zodResolver(CreateWorkflowRequestSchema),
    defaultValues: { name: '' },
  });

  const create = useMutation<WorkflowBody, Error, CreateOutput>({
    mutationFn: ({ name }) => createWorkflow(organizationId, name),
    onSuccess: async (workflow) => {
      await queryClient.invalidateQueries({ queryKey: workflowsKey(organizationId) });
      form.reset();
      await navigate({
        to: '/orgs/$organizationId/workflows/$workflowId',
        params: { organizationId, workflowId: workflow.id },
      });
    },
  });

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Workflows"
        description={
          canCreate
            ? 'Diseña un flujo de nodos, valídalo y publica versiones.'
            : 'Puedes abrir los workflows en modo de solo lectura.'
        }
      />

      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Nuevo workflow</CardTitle>
            <CardDescription>Empieza con un lienzo vacío y arma el flujo.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Form {...form}>
              <form
                noValidate
                onSubmit={(event) =>
                  void form.handleSubmit((values) => create.mutate(values))(event)
                }
                className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre del workflow</FormLabel>
                      <FormControl>
                        <Input autoComplete="off" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={create.isPending} className="sm:mt-[1.625rem]">
                  Crear workflow
                </Button>
              </form>
            </Form>
            {create.isError && <ProblemAlert error={create.error} />}
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4 text-body-sm">
              <Button asChild variant="secondary">
                <Link to="/orgs/$organizationId/workflows/new" params={{ organizationId }}>
                  <Sparkles aria-hidden />
                  Describir workflow
                </Link>
              </Button>
              <span className="text-ink-muted">
                ¿Prefieres contarlo con tus palabras? El compilador arma un borrador.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-3" aria-labelledby="workflows-list-title">
        <h2 id="workflows-list-title" className="text-title font-semibold text-ink">
          Tus workflows
        </h2>
        {workflows.isPending && <RowsSkeleton />}
        {workflows.isError && <ProblemAlert error={workflows.error} />}
        {workflows.data?.length === 0 && (
          <EmptyState
            titleAs="h3"
            title="Todavía no hay workflows."
            description={
              canCreate
                ? 'Crea el primero con el nombre de arriba o cuéntalo con tus palabras.'
                : 'Cuando alguien cree uno, aparecerá aquí.'
            }
            action={
              canCreate ? (
                <Button asChild variant="secondary">
                  <Link to="/orgs/$organizationId/workflows/new" params={{ organizationId }}>
                    <Sparkles aria-hidden />
                    Describir workflow
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="secondary">
                  <Link to="/orgs/$organizationId/runs" params={{ organizationId }}>
                    Ver ejecuciones
                  </Link>
                </Button>
              )
            }
          />
        )}
        {workflows.data && workflows.data.length > 0 && (
          <Table>
            <TableHeader className={STACKED.head}>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Versión activa</TableHead>
                <TableHead>Borrador modificado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.data.map((workflow) => (
                <TableRow key={workflow.id} className={STACKED.row}>
                  <TableCell className={STACKED.cell}>
                    <Link
                      to="/orgs/$organizationId/workflows/$workflowId"
                      params={{ organizationId, workflowId: workflow.id }}
                      className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
                    >
                      {workflow.name}
                    </Link>
                  </TableCell>
                  <TableCell className={STACKED.cell}>
                    {workflow.activeVersionNumber === null
                      ? 'Sin publicar'
                      : `Versión ${workflow.activeVersionNumber}`}
                  </TableCell>
                  <TableCell className={cn(STACKED.cell, 'text-ink-muted')}>
                    {new Date(workflow.draftUpdatedAt).toLocaleString('es')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
