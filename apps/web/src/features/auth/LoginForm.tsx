import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { SessionInfoSchema, type SessionInfo } from '@cognitive-dag/contracts';
import { request } from '../../api/client';
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../components/ui/form';
import { Input } from '../../components/ui/input';
import { ProblemAlert } from './ProblemAlert';

// Presence only: the API decides whether the credentials are right and never says which half failed.
const LoginFormSchema = z.object({
  email: z.string().trim().min(1, 'Ingresa tu correo electrónico.'),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
});

type LoginInput = z.input<typeof LoginFormSchema>;
type LoginOutput = z.output<typeof LoginFormSchema>;

export function LoginForm({ onLoggedIn }: { onLoggedIn: (info: SessionInfo) => void }) {
  const form = useForm<LoginInput, unknown, LoginOutput>({
    resolver: zodResolver(LoginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  const login = useMutation<SessionInfo, Error, LoginOutput>({
    mutationFn: async (values) =>
      (
        await request('/api/v1/auth/login', SessionInfoSchema, {
          method: 'POST',
          body: JSON.stringify(values),
        })
      ).data,
    onSuccess: onLoggedIn,
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Entra con tu correo y tu contraseña.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            onSubmit={(event) => void form.handleSubmit((values) => login.mutate(values))(event)}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correo electrónico</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="username" {...field} />
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
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {login.isError && <ProblemAlert error={login.error} />}
            <Button type="submit" disabled={login.isPending}>
              Iniciar sesión
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="justify-between text-sm">
        <a href="/register" className="underline">
          Crear cuenta
        </a>
        <a href="/forgot-password" className="underline">
          Olvidé mi contraseña
        </a>
        <a href="/verify-email" className="underline">
          Reenviar verificación
        </a>
      </CardFooter>
    </Card>
  );
}
