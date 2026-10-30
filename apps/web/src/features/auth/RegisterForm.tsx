import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { z } from 'zod';
import {
  AcceptedResponseSchema,
  OrganizationNameSchema,
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
import { PasswordInput } from '../../components/ui/password-input';
import { readPendingInvitation } from '../invitations/pending';
import { PASSWORD_MISMATCH } from './password-confirmation';
import { ProblemAlert } from './ProblemAlert';

/** The form always has an organization name (proposed from the name); the API field is optional. */
const RegisterFormSchema = RegisterRequestSchema.extend({
  organizationName: OrganizationNameSchema,
  passwordConfirmation: z.string(),
}).refine((values) => values.password === values.passwordConfirmation, {
  error: PASSWORD_MISMATCH,
  path: ['passwordConfirmation'],
});

type RegisterInput = z.input<typeof RegisterFormSchema>;
type RegisterOutput = z.output<typeof RegisterFormSchema>;

/** "Organización de <nombre>": the default the API would use, shown so the person can edit it. */
function proposedOrganizationName(name: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? '' : `Organización de ${trimmed}`.slice(0, 100);
}

/** Registration with the same Zod schema the API validates against (constitution, principle IV). */
export function RegisterForm() {
  const form = useForm<RegisterInput, unknown, RegisterOutput>({
    resolver: zodResolver(RegisterFormSchema),
    // Coming from an invitation link: the invitation is bound to that email.
    defaultValues: {
      name: '',
      email: readPendingInvitation()?.email ?? '',
      organizationName: '',
      password: '',
      passwordConfirmation: '',
    },
  });

  // The proposal follows the name until the person edits the organization name.
  const name = form.watch('name');
  const organizationEdited = form.formState.dirtyFields.organizationName === true;
  useEffect(() => {
    if (!organizationEdited) form.setValue('organizationName', proposedOrganizationName(name));
  }, [name, organizationEdited, form]);

  const register = useMutation<AcceptedResponse, Error, RegisterOutput>({
    mutationFn: async ({ name, email, password, organizationName }) =>
      (
        await request('/api/v1/auth/register', AcceptedResponseSchema, {
          method: 'POST',
          // The confirmation stays in the browser.
          body: JSON.stringify({ name, email, password, organizationName }),
        })
      ).data,
    onError: (error) => {
      if (error instanceof ApiProblemError && error.problem.code === 'VALIDATION_FAILED') {
        for (const { field, message } of error.problem.errors ?? []) {
          if (
            field === 'name' ||
            field === 'email' ||
            field === 'password' ||
            field === 'organizationName'
          ) {
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
              name="organizationName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre de la organización</FormLabel>
                  <FormControl>
                    <Input autoComplete="organization" {...field} />
                  </FormControl>
                  <FormDescription>
                    Es tu organización personal. Puedes cambiarlo ahora o más tarde.
                  </FormDescription>
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
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>
                    Entre 8 y 25 caracteres. Una frase con espacios es una buena opción.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="passwordConfirmation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmar contraseña</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
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
