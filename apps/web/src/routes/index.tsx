import { Link, createFileRoute } from '@tanstack/react-router';
import { buttonVariants } from '../components/ui/button';
import { homeRedirect } from '../features/session/guards';
import { sessionQuery } from '../features/session/session';

export const Route = createFileRoute('/')({
  // A signed-in user has no use for the landing page: send them to their organization.
  beforeLoad: async ({ context }) => {
    const info = await context.queryClient.fetchQuery(sessionQuery);
    if (info) throw homeRedirect(info);
  },
  component: Home,
});

function Home() {
  return (
    <div className="grid w-full gap-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">CognitiveDAG</h1>
        <p className="text-muted-foreground">Orquestador de workflows con IA.</p>
        <div className="mt-4 flex gap-2">
          <Link to="/login" className={buttonVariants()}>
            Iniciar sesión
          </Link>
          <Link to="/register" className={buttonVariants({ variant: 'outline' })}>
            Crear cuenta
          </Link>
        </div>
      </section>
    </div>
  );
}
