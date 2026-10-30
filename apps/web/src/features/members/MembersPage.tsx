import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  CreateInvitationRequestSchema,
  InvitationSchema,
  MemberSchema,
  RoleSchema,
  type Member,
  type Role,
} from '@cognitive-dag/contracts';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { ROLE_LABELS } from '../organizations/OrganizationSwitcher';
import { NoBodySchema, sessionQuery } from '../session/session';

type InviteInput = z.input<typeof CreateInvitationRequestSchema>;
type InviteOutput = z.output<typeof CreateInvitationRequestSchema>;

const ROLES = RoleSchema.options;

interface Feedback {
  onStart: () => void;
  onError: (error: unknown) => void;
}

const membersKey = (organizationId: string) => ['members', organizationId] as const;
const invitationsKey = (organizationId: string) => ['invitations', organizationId] as const;
const base = (organizationId: string) => `/api/v1/organizations/${organizationId}`;

/**
 * Members of the active organization. Everyone sees the list; only owners invite, change roles,
 * remove members and revoke invitations (FR-022, FR-032). The API enforces the same rules, the
 * controls are hidden for the others only to spare them a 403.
 */
export function MembersPage({ organizationId }: { organizationId: string }) {
  const session = useQuery(sessionQuery);
  const role = session.data?.organizations.find((item) => item.id === organizationId)?.role;
  const isOwner = role === 'owner';
  const currentUserId = session.data?.user.id;

  // One alert for the page: starting or finishing any action replaces what the last one said.
  const [actionError, setActionError] = useState<unknown>();
  const feedback = { onStart: () => setActionError(undefined), onError: setActionError };

  const members = useQuery({
    queryKey: membersKey(organizationId),
    queryFn: async () =>
      (await request(`${base(organizationId)}/members`, MemberSchema.array())).data,
  });

  return (
    <div className="grid w-full gap-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Miembros</h1>
        <p className="text-muted-foreground">
          {isOwner
            ? 'Invita personas, cambia sus roles o quítalas de la organización.'
            : 'Solo los owners pueden invitar, cambiar roles o quitar miembros.'}
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Personas con acceso</CardTitle>
        </CardHeader>
        <CardContent>
          {members.isError && <ProblemAlert error={members.error} />}
          {actionError !== undefined && <ProblemAlert error={actionError} />}
          {members.data && (
            <MembersTable
              organizationId={organizationId}
              members={members.data}
              isOwner={isOwner}
              currentUserId={currentUserId}
              feedback={feedback}
            />
          )}
        </CardContent>
      </Card>

      {isOwner && <InvitationsSection organizationId={organizationId} feedback={feedback} />}
    </div>
  );
}

function MembersTable({
  organizationId,
  members,
  isOwner,
  currentUserId,
  feedback,
}: {
  feedback: Feedback;
  organizationId: string;
  members: Member[];
  isOwner: boolean;
  currentUserId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<Member | undefined>();

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: membersKey(organizationId) });
    // Changing one's own role changes what the rest of the app shows.
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
  };

  const changeRole = useMutation<Member, Error, { membershipId: string; role: Role }>({
    mutationFn: async ({ membershipId, role }) =>
      (
        await request(`${base(organizationId)}/members/${membershipId}`, MemberSchema, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        })
      ).data,
    onMutate: feedback.onStart,
    onError: feedback.onError,
    onSettled: refresh,
  });

  const remove = useMutation<undefined, Error, string>({
    mutationFn: async (membershipId) =>
      (
        await request(`${base(organizationId)}/members/${membershipId}`, NoBodySchema, {
          method: 'DELETE',
        })
      ).data,
    onMutate: feedback.onStart,
    onSuccess: () => setRemoving(undefined),
    onSettled: refresh,
  });

  return (
    <div className="grid gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Correo</TableHead>
            <TableHead>Rol</TableHead>
            {isOwner && <TableHead>Acciones</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.membershipId}>
              <TableCell>
                {member.name}
                {member.userId === currentUserId && (
                  <span className="ml-2 text-xs text-muted-foreground">(tú)</span>
                )}
              </TableCell>
              <TableCell>{member.email}</TableCell>
              <TableCell>
                {isOwner ? (
                  <NativeSelect
                    aria-label={`Rol de ${member.name}`}
                    value={member.role}
                    disabled={changeRole.isPending}
                    onChange={(event) =>
                      changeRole.mutate({
                        membershipId: member.membershipId,
                        role: RoleSchema.parse(event.target.value),
                      })
                    }
                  >
                    {ROLES.map((option) => (
                      <option key={option} value={option}>
                        {ROLE_LABELS[option]}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  ROLE_LABELS[member.role]
                )}
              </TableCell>
              {isOwner && (
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Quitar a ${member.name}`}
                    onClick={() => {
                      remove.reset();
                      setRemoving(member);
                    }}
                  >
                    Quitar
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={removing !== undefined}
        onOpenChange={(open) => !open && setRemoving(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quitar a {removing?.name}</DialogTitle>
            <DialogDescription>
              Perderá el acceso a la organización en su siguiente petición. Podrás invitarla de
              nuevo cuando quieras.
            </DialogDescription>
          </DialogHeader>
          {remove.isError && <ProblemAlert error={remove.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(undefined)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing.membershipId)}
            >
              Quitar miembro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvitationsSection({
  organizationId,
  feedback,
}: {
  organizationId: string;
  feedback: Feedback;
}) {
  const queryClient = useQueryClient();
  const form = useForm<InviteInput, unknown, InviteOutput>({
    resolver: zodResolver(CreateInvitationRequestSchema),
    defaultValues: { email: '', role: 'viewer' },
  });

  const pending = useQuery({
    queryKey: invitationsKey(organizationId),
    queryFn: async () =>
      (await request(`${base(organizationId)}/invitations`, InvitationSchema.array())).data,
  });

  const invite = useMutation({
    mutationFn: async (values: InviteOutput) =>
      (
        await request(`${base(organizationId)}/invitations`, InvitationSchema, {
          method: 'POST',
          body: JSON.stringify(values),
        })
      ).data,
    onMutate: feedback.onStart,
    onError: feedback.onError,
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: invitationsKey(organizationId) });
    },
  });

  const revoke = useMutation<undefined, Error, string>({
    mutationFn: async (invitationId) =>
      (
        await request(`${base(organizationId)}/invitations/${invitationId}`, NoBodySchema, {
          method: 'DELETE',
        })
      ).data,
    onMutate: feedback.onStart,
    onError: feedback.onError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: invitationsKey(organizationId) }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitaciones</CardTitle>
        <CardDescription>
          Cada invitación es para un correo, sirve una vez y vence a los 7 días.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <Form {...form}>
          <form
            noValidate
            onSubmit={(event) => void form.handleSubmit((values) => invite.mutate(values))(event)}
            className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-start"
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correo de la persona</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rol</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {ROLES.map((option) => (
                        <option key={option} value={option}>
                          {ROLE_LABELS[option]}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={invite.isPending} className="sm:mt-[1.375rem]">
              Enviar invitación
            </Button>
          </form>
        </Form>
        {invite.isSuccess && (
          <Alert>
            <AlertDescription>Invitación enviada a {invite.data.email}.</AlertDescription>
          </Alert>
        )}

        {pending.isError && <ProblemAlert error={pending.error} />}
        {pending.data && pending.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.data.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>{invitation.email}</TableCell>
                  <TableCell>{ROLE_LABELS[invitation.role]}</TableCell>
                  <TableCell>{new Date(invitation.expiresAt).toLocaleDateString('es')}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Revocar la invitación de ${invitation.email}`}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(invitation.id)}
                    >
                      Revocar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {pending.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay invitaciones pendientes.</p>
        )}
      </CardContent>
    </Card>
  );
}
