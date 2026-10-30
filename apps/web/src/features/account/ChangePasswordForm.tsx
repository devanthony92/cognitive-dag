import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
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
import { PasswordInput } from '../../components/ui/password-input';
import { PASSWORD_MISMATCH } from '../auth/password-confirmation';
import { ProblemAlert } from '../auth/ProblemAlert';
import { NoBodySchema } from '../session/session';

const ChangeFormSchema = ChangePasswordRequestSchema.extend({
  newPasswordConfirmation: z.string(),
}).refine((values) => values.newPassword === values.newPasswordConfirmation, {
  error: PASSWORD_MISMATCH,
  path: ['newPasswordConfirmation'],
});

type ChangeInput = z.input<typeof ChangeFormSchema>;
type ChangeOutput = z.output<typeof ChangeFormSchema>;

/** Changing the password closes the other sessions and keeps this one (FR-009). */
export function ChangePasswordForm() {
  const form = useForm<ChangeInput, unknown, ChangeOutput>({
    resolver: zodResolver(ChangeFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', newPasswordConfirmation: '' },
  });
  const change = useMutation<undefined, Error, ChangeOutput>({
    mutationFn: async ({ currentPassword, newPassword }) =>
      (
        await request('/api/v1/auth/password/change', NoBodySchema, {
          method: 'POST',
          // The confirmation stays in the browser.
          body: JSON.stringify({ currentPassword, newPassword }),
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
                    <PasswordInput autoComplete="current-password" {...field} />
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
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>Entre 8 y 25 caracteres.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPasswordConfirmation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repite la contraseña nueva</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
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
