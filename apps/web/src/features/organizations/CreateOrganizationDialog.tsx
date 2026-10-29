import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  CreateOrganizationRequestSchema,
  OrganizationSummarySchema,
  type OrganizationSummary,
} from '@cognitive-dag/contracts';
import { request } from '../../api/client';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
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

type CreateInput = z.input<typeof CreateOrganizationRequestSchema>;
type CreateOutput = z.output<typeof CreateOrganizationRequestSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (organization: OrganizationSummary) => void;
}

export function CreateOrganizationDialog({ open, onOpenChange, onCreated }: Props) {
  const queryClient = useQueryClient();
  const form = useForm<CreateInput, unknown, CreateOutput>({
    resolver: zodResolver(CreateOrganizationRequestSchema),
    defaultValues: { name: '' },
  });

  const create = useMutation<OrganizationSummary, Error, CreateOutput>({
    mutationFn: async (values) =>
      (
        await request('/api/v1/organizations', OrganizationSummarySchema, {
          method: 'POST',
          body: JSON.stringify(values),
        })
      ).data,
    onSuccess: async (organization) => {
      // The switcher reads the organizations from the session, so refresh it before moving on.
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
      form.reset();
      onCreated(organization);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva organización</DialogTitle>
          <DialogDescription>
            Serás su owner y podrás cambiar entre organizaciones.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={(event) => void form.handleSubmit((values) => create.mutate(values))(event)}
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
            {create.isError && <ProblemAlert error={create.error} />}
            <Button type="submit" disabled={create.isPending}>
              Crear organización
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
