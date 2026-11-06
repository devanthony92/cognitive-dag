import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { ProblemAlert } from '../auth/ProblemAlert';
import { sessionQuery } from '../session/session';
import { workflowsQuery } from '../workflows/api';
import { compilationKey, compilationsKey, createCompilation } from './api';
import { CompilationView } from './CompilationView';
import { IntentForm } from './IntentForm';
import { RecentCompilations } from './RecentCompilations';

interface Props {
  organizationId: string;
  /** Present: regenerate the draft of this workflow; absent: describe a new one. */
  workflowId?: string | undefined;
}

/** "Describir workflow" (F6): intent, compilation in progress, preview and apply. */
export function CompilerPage({ organizationId, workflowId }: Props) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const role = session.data?.organizations.find((item) => item.id === organizationId)?.role;
  const canWrite = role === 'owner' || role === 'editor';
  const workflows = useQuery({
    ...workflowsQuery(organizationId),
    enabled: workflowId !== undefined,
  });
  const workflowName = workflows.data?.find((item) => item.id === workflowId)?.name;

  const [selectedId, setSelectedId] = useState<string | undefined>();
  // The text survives a failed compilation, so it can be edited and sent again.
  const [lastIntent, setLastIntent] = useState('');
  // A new key empties the compilation view and gives the form its text back.
  const [formKey, setFormKey] = useState(0);

  const create = useMutation({
    mutationFn: (intent: string) => createCompilation(organizationId, intent, workflowId),
    onSuccess: async (compilation) => {
      queryClient.setQueryData(compilationKey(organizationId, compilation.id), compilation);
      setSelectedId(compilation.id);
      await queryClient.invalidateQueries({
        queryKey: compilationsKey(organizationId, workflowId),
      });
    },
  });

  return (
    <div className="grid w-full gap-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          {workflowId === undefined ? 'Describir workflow' : 'Regenerar borrador'}
        </h1>
        <p className="text-muted-foreground">
          {workflowId === undefined
            ? 'Cuéntalo con tus palabras y el compilador arma un borrador. Nada se ejecuta hasta que lo publiques.'
            : `Describe de nuevo lo que quieres${workflowName ? ` para «${workflowName}»` : ''} y revisa la vista previa antes de reemplazar el borrador.`}
        </p>
        <p className="mt-1 text-sm">
          {workflowId === undefined ? (
            <Link
              to="/orgs/$organizationId/workflows"
              params={{ organizationId }}
              className="underline"
            >
              Volver a los workflows
            </Link>
          ) : (
            <Link
              to="/orgs/$organizationId/workflows/$workflowId"
              params={{ organizationId, workflowId }}
              className="underline"
            >
              Volver al editor
            </Link>
          )}
        </p>
      </section>

      <Alert>
        <AlertDescription>
          Esta función usa la capa gratuita de Gemini: Google puede usar lo que envíes para mejorar
          sus modelos. Escribe solo datos de prueba, nunca información real ni secretos.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Tu descripción</CardTitle>
          <CardDescription>
            Hasta 2000 caracteres, en español o inglés. Máximo 10 compilaciones por hora por
            persona.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {canWrite ? (
            <IntentForm
              key={formKey}
              initialIntent={lastIntent}
              pending={create.isPending}
              onSubmit={(intent) => {
                setLastIntent(intent);
                create.mutate(intent);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Tu rol no permite compilar. Puedes revisar las compilaciones recientes.
            </p>
          )}
          {create.isError && <ProblemAlert error={create.error} />}
        </CardContent>
      </Card>

      {selectedId !== undefined && (
        <CompilationView
          key={selectedId}
          organizationId={organizationId}
          compilationId={selectedId}
          canWrite={canWrite}
          onRetry={() => {
            setSelectedId(undefined);
            setFormKey((value) => value + 1);
          }}
        />
      )}

      <RecentCompilations
        organizationId={organizationId}
        workflowId={workflowId}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </div>
  );
}
