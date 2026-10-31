import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { useMemo } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import type { FieldSpec } from '@cognitive-dag/dag-schema';
import { ApiProblemError } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
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
import { Textarea } from '../../components/ui/textarea';
import { ProblemAlert } from '../auth/ProblemAlert';
import { runsKey, startRun } from './api';
import { buildInputSchema, defaultValues, isJsonType, type FormValues } from './run-input';
import { RUN_TEXT, notRunnableMessage } from './runnable';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  workflowId: string;
  workflowName: string;
  versionNumber: number;
  fields: readonly FieldSpec[];
}

const JSON_HINT: Record<string, string> = {
  list: 'Lista en formato JSON, por ejemplo ["a", "b"].',
  object: 'Objeto en formato JSON, por ejemplo {"clave": "valor"}.',
};

/** Form for the fields of the manual trigger; the API validates the input again (RUN_INPUT_INVALID). */
export function RunDialog({
  open,
  onOpenChange,
  organizationId,
  workflowId,
  workflowName,
  versionNumber,
  fields,
}: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const schema = useMemo(() => buildInputSchema(fields), [fields]);
  const form = useForm<FormValues, unknown, Record<string, unknown>>({
    resolver: zodResolver(schema) as unknown as Resolver<
      FormValues,
      unknown,
      Record<string, unknown>
    >,
    defaultValues: defaultValues(fields),
  });
  const { register, handleSubmit, setError, formState } = form;

  const start = useMutation({
    mutationFn: (input: Record<string, unknown>) => startRun(organizationId, workflowId, input),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: runsKey(organizationId, workflowId) });
      onOpenChange(false);
      await navigate({
        to: '/orgs/$organizationId/runs/$runId',
        params: { organizationId, runId: run.id },
      });
    },
    onError: (error) => {
      if (!(error instanceof ApiProblemError)) return;
      const names = new Set(fields.map((field) => field.name));
      let focused = false;
      for (const { field, message } of error.problem.errors ?? []) {
        const name = field.split('.')[0] ?? field;
        if (!names.has(name)) continue;
        setError(name, { message }, { shouldFocus: !focused });
        focused = true;
      }
    },
  });

  const problem = start.error instanceof ApiProblemError ? start.error.problem : undefined;
  const invalidInput = problem?.code === 'RUN_INPUT_INVALID';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!start.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ejecutar «{workflowName}»</DialogTitle>
          <DialogDescription>
            Se ejecuta la versión activa ({versionNumber}).{' '}
            {fields.length > 0
              ? 'Completa los datos de entrada del disparador.'
              : 'El disparador no pide datos de entrada.'}
          </DialogDescription>
        </DialogHeader>

        <form
          id="run-form"
          noValidate
          onSubmit={(event) => void handleSubmit((input) => start.mutate(input))(event)}
          className="grid gap-4"
        >
          {fields.map((field) => {
            const error = formState.errors[field.name]?.message;
            const id = `run-field-${field.name}`;
            const aria = {
              'aria-invalid': error !== undefined,
              'aria-describedby': error ? `${id}-error` : undefined,
            };
            const kind = field.type.kind;
            return (
              <div key={field.name} className="grid gap-1.5">
                {kind === 'boolean' ? (
                  <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
                    <input
                      id={id}
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary"
                      {...aria}
                      {...register(field.name)}
                    />
                    {field.name}
                  </label>
                ) : (
                  <Label htmlFor={id}>{field.name}</Label>
                )}
                {kind === 'string' && (
                  <Input id={id} autoComplete="off" {...aria} {...register(field.name)} />
                )}
                {kind === 'number' && (
                  <Input
                    id={id}
                    inputMode="decimal"
                    autoComplete="off"
                    {...aria}
                    {...register(field.name)}
                  />
                )}
                {kind === 'datetime' && (
                  <Input id={id} type="datetime-local" {...aria} {...register(field.name)} />
                )}
                {field.type.kind === 'enum' && (
                  <NativeSelect id={id} {...aria} {...register(field.name)}>
                    <option value="">Elige una opción</option>
                    {field.type.values.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                {isJsonType(field.type) && (
                  <>
                    <Textarea
                      id={id}
                      rows={3}
                      spellCheck={false}
                      className="font-mono text-xs"
                      {...aria}
                      {...register(field.name)}
                    />
                    <p className="text-xs text-muted-foreground">{JSON_HINT[kind]}</p>
                  </>
                )}
                {error && (
                  <p id={`${id}-error`} className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </form>

        {start.isError && (
          <div role="status" className="grid gap-2">
            {invalidInput ? (
              <Alert variant="destructive">
                <AlertDescription>{RUN_TEXT.invalidInput}</AlertDescription>
              </Alert>
            ) : problem?.code === 'WORKFLOW_NOT_RUNNABLE' ? (
              <Alert variant="destructive">
                <AlertDescription>{notRunnableMessage(problem)}</AlertDescription>
              </Alert>
            ) : (
              <ProblemAlert error={start.error} />
            )}
            {problem?.code === 'RUN_LIMIT_REACHED' && (
              <p className="text-sm text-muted-foreground">
                Puedes cancelar una ejecución en curso desde{' '}
                <Link
                  to="/orgs/$organizationId/workflows/$workflowId/runs"
                  params={{ organizationId, workflowId }}
                  className="underline"
                  onClick={() => onOpenChange(false)}
                >
                  la lista de ejecuciones
                </Link>
                .
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={start.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="submit" form="run-form" disabled={start.isPending}>
            <Play aria-hidden />
            {start.isPending ? 'Iniciando…' : 'Ejecutar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
