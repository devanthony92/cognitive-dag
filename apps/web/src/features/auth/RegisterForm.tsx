import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  AcceptedResponseSchema,
  RegisterRequestSchema,
  type AcceptedResponse,
} from '@cognitive-dag/contracts';
import { ApiProblemError, request } from '../../api/client';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
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
import { readPendingInvitation } from '../invitations/pending';
import { ProblemAlert } from './ProblemAlert';

type RegisterInput = z.input<typeof RegisterRequestSchema>;
type RegisterOutput = z.output<typeof RegisterRequestSchema>;

/** Registration with the same Zod schema the API validates against (constitution, principle IV). */
export function RegisterForm() {
  const form = useForm<RegisterInput, unknown, RegisterOutput>({
    resolver: zodResolver(RegisterRequestSchema),
    // Coming from an invitation link: the invitation is bound to that email.
    defaultValues: { name: '', email: readPendingInvitation()?.email ?? '', password: '' },
  });

  const register = useMutation<AcceptedResponse, Error, RegisterOutput>({
    mutationFn: async (values) =>
      (
        await request('/api/v1/auth/register', AcceptedResponseSchema, {
          method: 'POST',
          body: JSON.stringify(values),
        })
      ).data,
    onError: (error) => {
      if (error instanceof ApiProblemError && error.problem.code === 'VALIDATION_FAILED') {
        for (const { field, message } of error.problem.errors ?? []) {
          if (field === 'name' || field === 'email' || field === 'password') {
            form.setError(field, { message });
          }
        }
      }
    },
  });

  if (register.isSuccess) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Revisa tu correo</CardTitle>
          <CardDescription>{register.data.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>¿No llega nada?</AlertTitle>
            <AlertDescription>
              Revisa la carpeta de spam. Si ya tenías una cuenta, te avisamos por correo.{' '}
              <a href="/verify-email" className="underline">
                Reenviar el enlace de verificación
              </a>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const serverProblem = register.error;
  const hasFieldErrors =
    serverProblem instanceof ApiProblemError && serverProblem.problem.code === 'VALIDATION_FAILED';

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Crear cuenta</CardTitle>
        <CardDescription>Se creará también tu organización personal.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            onSubmit={(event) => void form.handleSubmit((values) => register.mutate(values))(event)}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>
                    Entre 15 y 128 caracteres. Una frase larga con espacios es una buena opción.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {register.isError && !hasFieldErrors && <ProblemAlert error={serverProblem} />}
            <Button type="submit" disabled={register.isPending}>
              Crear cuenta
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
