import { Inbox } from 'lucide-react';
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { ErrorClassSchema } from '@cognitive-dag/contracts';
import { CATEGORY_IDS } from '../components/category/categories';
import { CategoryIcon } from '../components/category/CategoryIcon';
import { StatusBadge, StatusMark } from '../components/status/StatusBadge';
import { SERVICE_STATES } from '../components/status/statusGlyphs';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { NativeSelect } from '../components/ui/native-select';
import { PageHeader } from '../components/ui/page-header';
import { PasswordInput } from '../components/ui/password-input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Textarea } from '../components/ui/textarea';
import { Toast } from '../components/ui/toast';
import { initTheme, setPreference } from '../lib/theme';
import { STEP_STATUS_LABELS } from '../features/runs/status';

initTheme();
// `?theme=dark` or `?theme=light` forces a mode, so a screenshot does not depend on the browser.
const forced = new URLSearchParams(location.search).get('theme');
if (forced === 'light' || forced === 'dark') setPreference(forced);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const STATE_STEP = {
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  waiting: 'running',
  cancelled: 'cancelled',
  skipped: 'skipped',
  reused: 'reused',
  pending: 'pending',
} as const;

function Gallery() {
  const [toast, setToast] = useState(false);
  return (
    <main className="mx-auto grid w-full max-w-page-default gap-10 px-4 py-8 sm:px-6">
      <PageHeader
        title="Galería de componentes"
        description="Solo en desarrollo: sirve para revisar y fotografiar los componentes base."
        action={<Button>Acción primaria</Button>}
      />
      <div className="flex flex-wrap gap-2">
        {(['system', 'light', 'dark'] as const).map((preference) => (
          <Button key={preference} variant="secondary" onClick={() => setPreference(preference)}>
            {preference === 'system' ? 'Sistema' : preference === 'light' ? 'Claro' : 'Oscuro'}
          </Button>
        ))}
      </div>

      <Section title="Botones">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="danger">Eliminar workflow</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="link">Enlace</Button>
          <Button size="icon" variant="secondary" aria-label="Icono">
            <Inbox />
          </Button>
          <Button disabled>Deshabilitado</Button>
        </div>
      </Section>

      <Section title="Estado de servicio">
        <div className="flex flex-wrap items-center gap-3">
          {SERVICE_STATES.map((state) => (
            <StatusBadge
              key={state}
              kind="step"
              status={STATE_STEP[state]}
              waitingReason={state === 'waiting' ? 'approval' : undefined}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {ErrorClassSchema.options.map((errorClass) => (
            <StatusBadge key={errorClass} kind="step" status="failed" errorClass={errorClass} />
          ))}
          <StatusBadge status="timed_out" />
          <StatusBadge status="queued" />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {SERVICE_STATES.map((state) => (
            <span key={state} className="flex items-center gap-2 text-body-sm text-ink-muted">
              <StatusMark state={state} label={STEP_STATUS_LABELS[STATE_STEP[state]]} />
              {state}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Categorías de nodo">
        <div className="flex flex-wrap gap-6">
          {CATEGORY_IDS.map((id) => (
            <CategoryIcon key={id} category={id} showLabel />
          ))}
        </div>
      </Section>

      <Section title="Campos">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="g-name">Nombre</Label>
            <Input id="g-name" placeholder="Cobro de facturas" />
            <p className="text-body-sm text-ink-muted">Cómo se verá en la lista.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="g-err">Correo</Label>
            <Input id="g-err" aria-invalid defaultValue="ana@" aria-describedby="g-err-msg" />
            <p id="g-err-msg" className="flex items-start gap-1.5 text-body-sm text-state-failed">
              Escribe un correo completo.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="g-role">Rol</Label>
            <NativeSelect id="g-role">
              <option>Editor</option>
              <option>Visor</option>
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="g-pass">Contraseña</Label>
            <PasswordInput id="g-pass" defaultValue="secreta-de-prueba" />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="g-notes">Notas</Label>
            <Textarea id="g-notes" rows={3} defaultValue="Texto de varias líneas." />
          </div>
        </div>
      </Section>

      <Section title="Tabla y panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estado</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead numeric>Duración</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <StatusBadge status="running" />
              </TableCell>
              <TableCell>Alta de clientes</TableCell>
              <TableCell numeric>3,2 s</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <StatusBadge status="failed" />
              </TableCell>
              <TableCell>Cobro de facturas con un nombre largo que debe contenerse</TableCell>
              <TableCell numeric>2 min 5 s</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Card>
          <CardHeader>
            <CardTitle>Panel de estación</CardTitle>
            <CardDescription>Capa tonal sin sombra: plano hasta que flota.</CardDescription>
          </CardHeader>
          <CardContent>Contenido del panel.</CardContent>
        </Card>
      </Section>

      <Section title="Avisos">
        <div className="grid gap-3">
          {(['default', 'destructive', 'success', 'warning'] as const).map((variant) => (
            <Alert key={variant} variant={variant}>
              <AlertTitle>Título del aviso</AlertTitle>
              <AlertDescription>
                Detalle en español llano, con el glifo de su tono.
              </AlertDescription>
            </Alert>
          ))}
        </div>
      </Section>

      <Section title="Superficies flotantes">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Abrir diálogo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>¿Eliminar el workflow?</DialogTitle>
              <DialogDescription>Esta acción no se puede deshacer.</DialogDescription>
              <div className="flex justify-end gap-2">
                <Button variant="secondary">Cancelar</Button>
                <Button variant="danger">Eliminar workflow</Button>
              </div>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Abrir menú</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Cuenta</DropdownMenuLabel>
              <DropdownMenuItem>Perfil</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Cerrar sesión</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="secondary" onClick={() => setToast(true)}>
            Mostrar aviso
          </Button>
        </div>
        {toast && (
          <Toast tone="success" message="Workflow guardado." onClose={() => setToast(false)} />
        )}
      </Section>

      <Section title="Carga y vacío">
        <div className="grid gap-3">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-13 w-full" />
          <Skeleton className="h-13 w-full" />
        </div>
        <EmptyState
          icon={Inbox}
          title="Aún no hay ejecuciones"
          description="Ejecuta un workflow publicado y aparecerá aquí."
          action={<Button>Ejecutar un workflow</Button>}
        />
      </Section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
