import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AcceptedResponseSchema, EmailRequestSchema } from '@cognitive-dag/contracts';
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
import { ProblemAlert } from './ProblemAlert';

const NoBodySchema = z.undefined();

type ResendInput = z.input<typeof EmailRequestSchema>;
type ResendOutput = z.output<typeof EmailRequestSchema>;

function ResendForm() {
  const form = useForm<ResendInput, unknown, ResendOutput>({
    resolver: zodResolver(EmailRequestSchema),
    defaultValues: { email: '' },
  });
  const resend = useMutation({
    mutationFn: async (values: ResendOutput) =>
      (
        await request('/api/v1/auth/verify-email/resend', AcceptedResponseSchema, {
          method: 'POST',
          body: JSON.stringify(values),
        })
      ).data,
  });

  if (resend.isSuccess) {
    return (
      <Alert>
        <AlertDescription>{resend.data.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => resend.mutate(values))(event)}
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
        {resend.isError && <ProblemAlert error={resend.error} />}
        <Button type="submit" disabled={resend.isPending}>
          Reenviar enlace
        </Button>
      </form>
    </Form>
  );
}

/**
 * Consumes the verification token. The token arrives as a prop (the route removes it from the
 * address bar) and travels in the request body, never in a URL.
 */
export function VerifyEmailPanel({ token }: { token: string | undefined }) {
  const verification = useQuery({
    queryKey: ['verify-email', token],
    enabled: token !== undefined,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      await request('/api/v1/auth/verify-email', NoBodySchema, {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      return true;
    },
  });

  const verified = verification.isSuccess;
  const failed = token === undefined || verification.isError;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Verificación de correo</CardTitle>
        <CardDescription>
          {verified
            ? 'Tu correo quedó verificado.'
            : failed
              ? token === undefined
                ? 'Pide un enlace nuevo para verificar tu correo.'
                : 'El enlace no es válido, ya fue usado o está vencido.'
              : 'Verificando tu correo…'}
        </CardDescription>
      </CardHeader>
      {failed && (
        <CardContent className="grid gap-4">
          {verification.isError && verification.error instanceof Error && (
            <ProblemAlert error={verification.error} />
          )}
          <ResendForm />
        </CardContent>
      )}
    </Card>
  );
}
