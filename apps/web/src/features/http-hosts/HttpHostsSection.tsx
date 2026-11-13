import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  HttpAllowedHostListSchema,
  HttpAllowedHostSchema,
  type HttpAllowedHost,
} from '@cognitive-dag/contracts';
import { request } from '../../api/client';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { ProblemAlert } from '../auth/ProblemAlert';
import { NoBodySchema } from '../session/session';

const base = (organizationId: string) =>
  `/api/v1/organizations/${organizationId}/http-allowed-hosts`;
const hostsKey = (organizationId: string) => ['http-hosts', organizationId] as const;

export const httpHostsQuery = (organizationId: string) =>
  queryOptions({
    queryKey: hostsKey(organizationId),
    queryFn: async () =>
      (await request(base(organizationId), HttpAllowedHostListSchema)).data.items,
    retry: false,
  });

/**
 * Optional allowlist of destinations (F7, US9). Empty means "any public address"; with entries,
 * `http.request` nodes can only reach those hosts. Owners edit it; editors read it.
 */
export function HttpHostsSection({
  organizationId,
  isOwner,
}: {
  organizationId: string;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const hosts = useQuery(httpHostsQuery(organizationId));
  const [pattern, setPattern] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: hostsKey(organizationId) });

  const add = useMutation({
    mutationFn: async () =>
      (
        await request(base(organizationId), HttpAllowedHostSchema, {
          method: 'POST',
          body: JSON.stringify({ pattern: pattern.trim() }),
        })
      ).data,
    onSuccess: () => setPattern(''),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (host: HttpAllowedHost) => {
      await request(`${base(organizationId)}/${host.id}`, NoBodySchema, { method: 'DELETE' });
    },
    onSettled: refresh,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Destinos permitidos</CardTitle>
        <CardDescription>
          Lista opcional de dominios a los que pueden llamar los nodos «Petición HTTP». Mientras
          esté vacía, se permite cualquier dirección pública; las privadas se bloquean siempre.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {hosts.isPending && (
          <div role="status" className="grid gap-2">
            <span className="sr-only">Cargando destinos</span>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        )}
        {hosts.isError && <ProblemAlert error={hosts.error} />}
        {remove.isError && <ProblemAlert error={remove.error} />}
        {hosts.isSuccess && hosts.data.length === 0 && (
          <EmptyState
            titleAs="h3"
            title="Sin destinos configurados"
            description="La lista está vacía: no hay más restricción que el bloqueo de direcciones privadas."
            action={
              isOwner ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => document.getElementById('host-pattern')?.focus()}
                >
                  Agregar un destino
                </Button>
              ) : undefined
            }
          />
        )}
        {hosts.isSuccess && hosts.data.length > 0 && (
          <ul className="grid gap-1">
            {hosts.data.map((host) => (
              <li
                key={host.id}
                className="flex items-center justify-between gap-2 rounded-md border border-line p-2"
              >
                <code className="text-body-sm break-all">{host.pattern}</code>
                {isOwner && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Retirar ${host.pattern}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(host)}
                  >
                    Retirar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isOwner ? (
          <form
            className="grid gap-2 border-t border-line pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate();
            }}
          >
            <Label htmlFor="host-pattern">Dominio o *.dominio</Label>
            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
              <Input
                id="host-pattern"
                className="min-w-0 flex-1"
                value={pattern}
                required
                placeholder="api.example.com o *.partner.com"
                onChange={(event) => setPattern(event.target.value)}
              />
              <Button type="submit" disabled={add.isPending}>
                Agregar
              </Button>
            </div>
            {add.isError && <ProblemAlert error={add.error} />}
          </form>
        ) : (
          <p className="text-body-sm text-ink-muted">Solo los owners editan la lista.</p>
        )}
      </CardContent>
    </Card>
  );
}
