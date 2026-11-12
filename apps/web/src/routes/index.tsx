import { Link, createFileRoute } from '@tanstack/react-router';
import { buttonVariants } from '../components/ui/button';
import { homeRedirect } from '../features/session/guards';
import { sessionQuery } from '../features/session/session';

export const Route = createFileRoute('/')({
  staticData: { width: 'narrow' },
  // A signed-in user has no use for the landing page: send them to their organization.
  beforeLoad: async ({ context }) => {
    const info = await context.queryClient.fetchQuery(sessionQuery);
    if (info) throw homeRedirect(info);
  },
  component: Home,
});

function Home() {
  return (
    <div className="grid w-full gap-6">
      <section className="grid gap-2">
        <h1 className="text-display font-bold tracking-tight">CognitiveDAG</h1>
        <p className="text-ink-muted">Orquestador de workflows con IA.</p>
        <p className="text-body-sm text-ink-muted">El acceso es por invitación.</p>
        <div className="mt-4">
          <Link to="/login" className={buttonVariants()}>
            Iniciar sesión
          </Link>
        </div>
      </section>
    </div>
  );
}
