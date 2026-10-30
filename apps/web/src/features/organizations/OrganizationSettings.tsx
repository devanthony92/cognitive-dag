import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  OrganizationSummarySchema,
  RenameOrganizationRequestSchema,
  type OrganizationSummary,
  type SessionInfo,
} from '@cognitive-dag/contracts';
import { request } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
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
import { ProblemAlert } from '../auth/ProblemAlert';
import { sessionQuery } from '../session/session';

type RenameInput = z.input<typeof RenameOrganizationRequestSchema>;
type RenameOutput = z.output<typeof RenameOrganizationRequestSchema>;

/** Owner-only settings of an organization (FR-036). Anyone else sees nothing. */
export function OrganizationSettings({ organizationId }: { organizationId: string }) {
  const session = useQuery(sessionQuery);
  const organization = session.data?.organizations.find((item) => item.id === organizationId);
  if (organization?.role !== 'owner') return null;
  return <RenameForm organization={organization} />;
}

function RenameForm({ organization }: { organization: OrganizationSummary }) {
  const queryClient = useQueryClient();
  const form = useForm<RenameInput, unknown, RenameOutput>({
    resolver: zodResolver(RenameOrganizationRequestSchema),
    defaultValues: { name: organization.name },
  });

  const rename = useMutation<OrganizationSummary, Error, RenameOutput>({
    mutationFn: async (values) =>
      (
        await request(`/api/v1/organizations/${organization.id}`, OrganizationSummarySchema, {
          method: 'PATCH',
          body: JSON.stringify(values),
        })
      ).data,
    onSuccess: (renamed) => {
      // The switcher and the headers read the name from the session: update it in place so they
      // change at once, then let a refetch confirm it.
      queryClient.setQueryData<SessionInfo | null>(sessionQuery.queryKey, (current) =>
        current
          ? {
              ...current,
              organizations: current.organizations.map((item) =>
                item.id === renamed.id ? { ...item, name: renamed.name } : item,
              ),
            }
          : current,
      );
      form.reset({ name: renamed.name });
      void queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ajustes de la organización</CardTitle>
        <CardDescription>Solo los owners pueden cambiar el nombre.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            onSubmit={(event) => void form.handleSubmit((values) => rename.mutate(values))(event)}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre de la organización</FormLabel>
                  <FormControl>
                    <Input autoComplete="organization" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {rename.isSuccess && (
              <Alert>
                <AlertDescription>Nombre actualizado.</AlertDescription>
              </Alert>
            )}
            {rename.isError && <ProblemAlert error={rename.error} />}
            <Button type="submit" disabled={rename.isPending}>
              Guardar nombre
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
