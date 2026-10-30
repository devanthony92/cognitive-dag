import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
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
import { Input } from '../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
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
    <div className="grid w-full gap-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <p className="text-muted-foreground">
          {canCreate
            ? 'Diseña un flujo de nodos, valídalo y publica versiones.'
            : 'Puedes abrir los workflows en modo de solo lectura.'}
        </p>
      </section>

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
                <Button type="submit" disabled={create.isPending} className="sm:mt-[1.375rem]">
                  Crear workflow
                </Button>
              </form>
            </Form>
            {create.isError && <ProblemAlert error={create.error} />}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tus workflows</CardTitle>
        </CardHeader>
        <CardContent>
          {workflows.isError && <ProblemAlert error={workflows.error} />}
          {workflows.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">Todavía no hay workflows.</p>
          )}
          {workflows.data && workflows.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Versión activa</TableHead>
                  <TableHead>Borrador modificado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.data.map((workflow) => (
                  <TableRow key={workflow.id}>
                    <TableCell>
                      <Link
                        to="/orgs/$organizationId/workflows/$workflowId"
                        params={{ organizationId, workflowId: workflow.id }}
                        className="font-medium underline"
                      >
                        {workflow.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {workflow.activeVersionNumber === null
                        ? 'Sin publicar'
                        : `Versión ${workflow.activeVersionNumber}`}
                    </TableCell>
                    <TableCell>{new Date(workflow.draftUpdatedAt).toLocaleString('es')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
