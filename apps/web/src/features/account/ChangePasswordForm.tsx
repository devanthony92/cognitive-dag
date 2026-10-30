import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ChangePasswordRequestSchema } from '@cognitive-dag/contracts';
import { ApiProblemError, request } from '../../api/client';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../components/ui/form';
import { Input } from '../../components/ui/input';
import { ProblemAlert } from '../auth/ProblemAlert';
import { NoBodySchema } from '../session/session';

type ChangeInput = z.input<typeof ChangePasswordRequestSchema>;
type ChangeOutput = z.output<typeof ChangePasswordRequestSchema>;

/** Changing the password closes the other sessions and keeps this one (FR-009). */
export function ChangePasswordForm() {
  const form = useForm<ChangeInput, unknown, ChangeOutput>({
    resolver: zodResolver(ChangePasswordRequestSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const change = useMutation<undefined, Error, ChangeOutput>({
    mutationFn: async (values) =>
      (
        await request('/api/v1/auth/password/change', NoBodySchema, {
          method: 'POST',
          body: JSON.stringify(values),
        })
      ).data,
    onSuccess: () => form.reset(),
    onError: (error) => {
      if (error instanceof ApiProblemError && error.problem.code === 'INVALID_CREDENTIALS') {
        form.setError('currentPassword', { message: 'La contraseña actual no es correcta.' });
      }
      if (error instanceof ApiProblemError && error.problem.code === 'VALIDATION_FAILED') {
        for (const { field, message } of error.problem.errors ?? []) {
          // The API reports the policy under "password"; on this form it is the new one.
          if (field === 'password' || field === 'newPassword') {
            form.setError('newPassword', { message });
          }
        }
      }
    },
  });

  const hasFieldErrors =
    change.error instanceof ApiProblemError &&
    ['VALIDATION_FAILED', 'INVALID_CREDENTIALS'].includes(change.error.problem.code);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Cambiar contraseña</CardTitle>
        <CardDescription>Cerraremos tus otras sesiones; esta seguirá abierta.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            onSubmit={(event) => void form.handleSubmit((values) => change.mutate(values))(event)}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña actual</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña nueva</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>Entre 15 y 128 caracteres.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {change.isSuccess && (
              <Alert>
                <AlertDescription>
                  Contraseña actualizada. Tus otras sesiones se cerraron.
                </AlertDescription>
              </Alert>
            )}
            {change.isError && !hasFieldErrors && <ProblemAlert error={change.error} />}
            <Button type="submit" disabled={change.isPending}>
              Cambiar contraseña
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
