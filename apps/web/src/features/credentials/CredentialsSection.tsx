import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Credential, CredentialKind } from '@cognitive-dag/contracts';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { NativeSelect } from '../../components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { ProblemAlert } from '../auth/ProblemAlert';
import { formatDateTime } from '../runs/status';
import {
  archiveCredential,
  createCredential,
  credentialsKey,
  credentialsQuery,
  rotateCredential,
} from './api';

export const KIND_LABELS: Record<CredentialKind, string> = {
  bearer: 'Bearer (Authorization: Bearer …)',
  api_key_header: 'Llave en una cabecera',
  basic: 'Basic (usuario y clave)',
};

const SECRET_HINT: Record<CredentialKind, string> = {
  bearer: 'El token, sin la palabra «Bearer».',
  api_key_header: 'El valor de la llave.',
  basic: 'Con la forma usuario:clave.',
};

/**
 * Credentials of the organization (F7, US8). Owners create, rotate and archive; editors only see
 * the metadata. The secret is typed here and sent once: no screen ever shows it again.
 */
export function CredentialsSection({
  organizationId,
  isOwner,
}: {
  organizationId: string;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const credentials = useQuery(credentialsQuery(organizationId));
  const [rotating, setRotating] = useState<Credential | undefined>();
  const [archiving, setArchiving] = useState<Credential | undefined>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: credentialsKey(organizationId) });

  const archive = useMutation({
    mutationFn: (credential: Credential) => archiveCredential(organizationId, credential.id),
    onSuccess: () => setArchiving(undefined),
    onSettled: refresh,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credenciales</CardTitle>
        <CardDescription>
          Secretos con los que los nodos «Petición HTTP» se autentican. Se guardan cifrados y no se
          pueden volver a ver: solo reemplazar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {credentials.isPending && <p role="status">Cargando credenciales…</p>}
        {credentials.isError && <ProblemAlert error={credentials.error} />}
        {archive.isError && <ProblemAlert error={archive.error} />}
        {credentials.isSuccess && credentials.data.length === 0 && (
          <p className="text-muted-foreground">Todavía no hay credenciales.</p>
        )}
        {credentials.isSuccess && credentials.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Creada</TableHead>
                <TableHead>Rotada</TableHead>
                {isOwner && (
                  <TableHead>
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.data.map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell>{credential.name}</TableCell>
                  <TableCell>
                    {KIND_LABELS[credential.kind]}
                    {credential.headerName ? ` (${credential.headerName})` : ''}
                  </TableCell>
                  <TableCell>
                    {formatDateTime(credential.createdAt)} por {credential.createdBy.name}
                  </TableCell>
                  <TableCell>
                    {credential.rotatedAt ? formatDateTime(credential.rotatedAt) : '—'}
                  </TableCell>
                  {isOwner && (
                    <TableCell className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Rotar ${credential.name}`}
                        onClick={() => setRotating(credential)}
                      >
                        Rotar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Archivar ${credential.name}`}
                        onClick={() => setArchiving(credential)}
                      >
                        Archivar
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {isOwner ? (
          <CreateCredentialForm organizationId={organizationId} onCreated={refresh} />
        ) : (
          <p className="text-sm text-muted-foreground">Solo los owners administran credenciales.</p>
        )}
      </CardContent>

      {rotating && (
        <RotateDialog
          organizationId={organizationId}
          credential={rotating}
          onClose={() => setRotating(undefined)}
          onRotated={refresh}
        />
      )}
      <Dialog
        open={archiving !== undefined}
        onOpenChange={(open) => !open && setArchiving(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Archivar «{archiving?.name}»?</DialogTitle>
            <DialogDescription>
              Los workflows que la usan dejarán de poder publicarse y sus nodos fallarán al
              ejecutarse.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiving(undefined)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={archive.isPending}
              onClick={() => archiving && archive.mutate(archiving)}
            >
              Archivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CreateCredentialForm({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated: () => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CredentialKind>('bearer');
  const [headerName, setHeaderName] = useState('');
  const [secret, setSecret] = useState('');

  const create = useMutation({
    mutationFn: () =>
      createCredential(organizationId, {
        name: name.trim(),
        kind,
        ...(kind === 'api_key_header' ? { headerName: headerName.trim() } : {}),
        secret,
      }),
    onSuccess: () => {
      // The secret leaves the screen as soon as it is sent.
      setName('');
      setHeaderName('');
      setSecret('');
    },
    onSettled: onCreated,
  });

  return (
    <form
      className="grid gap-3 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h2 className="text-sm font-semibold">Nueva credencial</h2>
      <div className="grid gap-1.5">
        <Label htmlFor="credential-name">Nombre</Label>
        <Input
          id="credential-name"
          value={name}
          maxLength={64}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="credential-kind">Tipo</Label>
        <NativeSelect
          id="credential-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as CredentialKind)}
        >
          {(Object.keys(KIND_LABELS) as CredentialKind[]).map((option) => (
            <option key={option} value={option}>
              {KIND_LABELS[option]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {kind === 'api_key_header' && (
        <div className="grid gap-1.5">
          <Label htmlFor="credential-header">Nombre de la cabecera</Label>
          <Input
            id="credential-header"
            value={headerName}
            required
            placeholder="X-Api-Key"
            onChange={(event) => setHeaderName(event.target.value)}
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="credential-secret">Secreto</Label>
        <Input
          id="credential-secret"
          type="password"
          autoComplete="off"
          value={secret}
          required
          maxLength={4096}
          onChange={(event) => setSecret(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{SECRET_HINT[kind]}</p>
      </div>
      {create.isError && <ProblemAlert error={create.error} />}
      <div>
        <Button type="submit" disabled={create.isPending}>
          Crear credencial
        </Button>
      </div>
    </form>
  );
}

function RotateDialog({
  organizationId,
  credential,
  onClose,
  onRotated,
}: {
  organizationId: string;
  credential: Credential;
  onClose: () => void;
  onRotated: () => Promise<unknown>;
}) {
  const [secret, setSecret] = useState('');
  const rotate = useMutation({
    mutationFn: () => rotateCredential(organizationId, credential.id, secret),
    onSuccess: () => {
      setSecret('');
      onClose();
    },
    onSettled: onRotated,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            rotate.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rotar «{credential.name}»</DialogTitle>
            <DialogDescription>
              Escribe el secreto nuevo. Reemplaza al anterior, que no se puede recuperar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="rotate-secret">Secreto nuevo</Label>
            <Input
              id="rotate-secret"
              type="password"
              autoComplete="off"
              required
              maxLength={4096}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </div>
          {rotate.isError && <ProblemAlert error={rotate.error} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={rotate.isPending}>
              Rotar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
