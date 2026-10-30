import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  AcceptedResponseSchema,
  EmailRequestSchema,
  PasswordResetConfirmRequestSchema,
} from '@cognitive-dag/contracts';
import { ApiProblemError, request } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { PasswordInput } from '../../components/ui/password-input';
import { forgetSession, NoBodySchema } from '../session/session';
import { PASSWORD_MISMATCH } from './password-confirmation';
import { ProblemAlert } from './ProblemAlert';

type EmailInput = z.input<typeof EmailRequestSchema>;
type EmailOutput = z.output<typeof EmailRequestSchema>;

/** Asks for a reset link. The answer is the same for every address (FR-014). */
export function ForgotPasswordForm() {
  const form = useForm<EmailInput, unknown, EmailOutput>({
    resolver: zodResolver(EmailRequestSchema),
    defaultValues: { email: '' },
  });
  const requestReset = useMutation({
    mutationFn: async (values: EmailOutput) =>
      (
        await request('/api/v1/auth/password-reset/request', AcceptedResponseSchema, {
          method: 'POST',
          body: JSON.stringify(values),
        })
      ).data,
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Recuperar contraseña</CardTitle>
        <CardDescription>
          Escribe tu correo y te enviaremos un enlace para elegir una contraseña nueva.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {requestReset.isSuccess ? (
          <Alert>
            <AlertDescription>
              {requestReset.data.message} El enlace vence en 30 minutos.
            </AlertDescription>
          </Alert>
        ) : (
          <Form {...form}>
            <form
              noValidate
              onSubmit={(event) =>
                void form.handleSubmit((values) => requestReset.mutate(values))(event)
              }
              className="grid gap-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Correo electrónico</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {requestReset.isError && <ProblemAlert error={requestReset.error} />}
              <Button type="submit" disabled={requestReset.isPending}>
                Enviar enlace
              </Button>
            </form>
          </Form>
        )}
      </CardContent>
      <CardFooter className="text-sm">
        <a href="/login" className="underline">
          Volver a iniciar sesión
        </a>
      </CardFooter>
    </Card>
  );
}

const NewPasswordSchema = PasswordResetConfirmRequestSchema.pick({ password: true })
  .extend({ passwordConfirmation: z.string() })
  .refine((values) => values.password === values.passwordConfirmation, {
    error: PASSWORD_MISMATCH,
    path: ['passwordConfirmation'],
  });
type NewPasswordInput = z.input<typeof NewPasswordSchema>;
type NewPasswordOutput = z.output<typeof NewPasswordSchema>;

/**
 * Sets the new password. The token arrives as a prop (the route removes it from the address bar)
 * and travels in the request body, never in a URL.
 */
export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const queryClient = useQueryClient();
  const form = useForm<NewPasswordInput, unknown, NewPasswordOutput>({
    resolver: zodResolver(NewPasswordSchema),
    defaultValues: { password: '', passwordConfirmation: '' },
  });
  const confirm = useMutation<undefined, Error, NewPasswordOutput>({
    mutationFn: async (values) =>
      (
        await request('/api/v1/auth/password-reset/confirm', NoBodySchema, {
          method: 'POST',
          body: JSON.stringify({ token, password: values.password }),
        })
      ).data,
    // Every session was revoked on the server; do not keep showing a signed-in header.
    onSuccess: () => forgetSession(queryClient),
    onError: (error) => {
      if (error instanceof ApiProblemError && error.problem.code === 'VALIDATION_FAILED') {
        for (const { field, message } of error.problem.errors ?? []) {
          if (field === 'password') form.setError('password', { message });
        }
      }
    },
  });

  if (token === undefined) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Enlace no válido</CardTitle>
          <CardDescription>Pide un enlace nuevo para restablecer tu contraseña.</CardDescription>
        </CardHeader>
        <CardFooter>
          <a href="/forgot-password" className="text-sm underline">
            Pedir un enlace nuevo
          </a>
        </CardFooter>
      </Card>
    );
  }

  if (confirm.isSuccess) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Contraseña actualizada</CardTitle>
          <CardDescription>
            Cerramos todas tus sesiones. Inicia sesión con la contraseña nueva.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <a href="/login" className="text-sm underline">
            Iniciar sesión
          </a>
        </CardFooter>
      </Card>
    );
  }

  const tokenRejected =
    confirm.error instanceof ApiProblemError && confirm.error.problem.code === 'TOKEN_INVALID';
  const hasFieldErrors =
    confirm.error instanceof ApiProblemError && confirm.error.problem.code === 'VALIDATION_FAILED';

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Elegir contraseña nueva</CardTitle>
        <CardDescription>El enlace sirve una sola vez y vence a los 30 minutos.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            onSubmit={(event) => void form.handleSubmit((values) => confirm.mutate(values))(event)}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="password"
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
              name="passwordConfirmation"
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
            {confirm.isError && !hasFieldErrors && <ProblemAlert error={confirm.error} />}
            <Button type="submit" disabled={confirm.isPending}>
              Cambiar contraseña
            </Button>
          </form>
        </Form>
      </CardContent>
      {tokenRejected && (
        <CardFooter>
          <a href="/forgot-password" className="text-sm underline">
            Pedir un enlace nuevo
          </a>
        </CardFooter>
      )}
    </Card>
  );
}
