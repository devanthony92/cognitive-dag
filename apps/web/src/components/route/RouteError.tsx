import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { Check, Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiProblemError, UnexpectedResponseError } from '../../api/client';
import { Button, buttonVariants } from '../ui/button';

/** Seconds to wait before each automatic retry of a restart (1, 2 and 4), at most three times. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

type Failure =
  | { kind: 'problem'; title: string; detail: string; correlationId: string | null }
  | { kind: 'restarting' }
  | { kind: 'chunk' }
  | { kind: 'unknown' };

const CHUNK_FAILURE =
  /dynamically imported module|error loading dynamically|importing a module script failed|ChunkLoadError/i;
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

function titleForStatus(status: number): string {
  if (status === 403) return 'No tienes acceso a esto';
  if (status === 404) return 'No encontramos lo que buscas';
  if (status >= 500) return 'Algo falló de nuestro lado';
  return 'No pudimos completar la solicitud';
}

/** Sorts what a route threw into the four cases the panel knows how to explain. */
export function classify(error: unknown): Failure {
  if (error instanceof ApiProblemError && [502, 503, 504].includes(error.problem.status)) {
    return { kind: 'restarting' };
  }
  if (error instanceof ApiProblemError) {
    return {
      kind: 'problem',
      title: titleForStatus(error.problem.status),
      detail: error.problem.detail,
      correlationId: error.problem.correlationId,
    };
  }
  if (error instanceof UnexpectedResponseError && [502, 503, 504].includes(error.status)) {
    return { kind: 'restarting' };
  }
  if (error instanceof Error && CHUNK_FAILURE.test(error.message)) return { kind: 'chunk' };
  if (error instanceof TypeError && NETWORK_FAILURE.test(error.message)) {
    return { kind: 'restarting' };
  }
  return { kind: 'unknown' };
}

/** Automatic retries already made per address, so a remount does not start the count again. */
const retriesByLocation = new Map<string, number>();

/** Forgets the retries; called when a navigation succeeds so the next outage retries again. */
export function resetRouteRetries(): void {
  retriesByLocation.clear();
}

function CorrelationId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      // Clipboard blocked: the id stays visible and selectable.
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
      <span>Id de correlación</span>
      <code className="rounded-sm bg-raised px-2 py-1 break-all text-ink select-all">{id}</code>
      <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? 'Copiado' : 'Copiar'}
        <span className="sr-only"> id de correlación</span>
      </Button>
    </div>
  );
}

/** The panel itself: used by the router and, with its own frame, by the root fallback. */
export function ErrorPanel({
  title,
  children,
  actions,
}: {
  title: string;
  children?: React.ReactNode;
  actions: React.ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section
      role="alert"
      className="mx-auto my-8 grid w-full max-w-page-narrow gap-4 rounded-lg border border-line bg-surface p-6"
    >
      <h1
        ref={heading}
        tabIndex={-1}
        className="flex items-center gap-2 text-headline font-bold outline-none"
      >
        <TriangleAlert aria-hidden className="size-6 shrink-0 text-state-failed" />
        {title}
      </h1>
      {children}
      <div className="flex flex-wrap gap-2">{actions}</div>
    </section>
  );
}

/**
 * Error boundary of every route (`defaultErrorComponent`). It never shows the router's default text:
 * a problem shows its detail and correlation id, a restart retries by itself, a stale chunk asks for a
 * reload, and anything else gets a plain sentence without internals. The shell stays around it.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const failure = classify(error);
  const href = router.state.location.href;
  const attempts = retriesByLocation.get(href) ?? 0;
  const waiting = failure.kind === 'restarting' && attempts < RETRY_DELAYS_MS.length;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      retriesByLocation.set(href, attempts + 1);
      reset();
      void router.invalidate();
    }, RETRY_DELAYS_MS[attempts]);
    return () => clearTimeout(timer);
  }, [waiting, attempts, href, reset, router]);

  const retry = (
    <Button
      type="button"
      onClick={() => {
        reset();
        void router.invalidate();
      }}
    >
      <RefreshCw aria-hidden />
      Reintentar
    </Button>
  );
  const back = (
    <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
      Volver
    </Link>
  );

  if (failure.kind === 'chunk') {
    return (
      <ErrorPanel
        title="Hay una versión nueva"
        actions={
          <Button type="button" onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden />
            Recargar
          </Button>
        }
      >
        <p>
          Publicamos una actualización mientras tenías la página abierta. Recárgala para seguir.
        </p>
      </ErrorPanel>
    );
  }
  if (failure.kind === 'restarting') {
    return (
      <ErrorPanel
        title="El servicio se está reiniciando"
        actions={
          <>
            {retry}
            {back}
          </>
        }
      >
        <p>
          {waiting
            ? 'Estamos volviendo a intentarlo automáticamente. No pierdes nada de lo guardado.'
            : 'Sigue sin responder. Espera unos segundos y vuelve a intentarlo.'}
        </p>
      </ErrorPanel>
    );
  }
  if (failure.kind === 'problem') {
    return (
      <ErrorPanel
        title={failure.title}
        actions={
          <>
            {retry}
            {back}
          </>
        }
      >
        <p>{failure.detail}</p>
        {failure.correlationId && <CorrelationId id={failure.correlationId} />}
      </ErrorPanel>
    );
  }
  return (
    <ErrorPanel
      title="No pudimos cargar esta página"
      actions={
        <>
          {retry}
          {back}
        </>
      }
    >
      <p>Ocurrió un error inesperado. Inténtalo de nuevo; si sigue igual, vuelve al inicio.</p>
    </ErrorPanel>
  );
}
