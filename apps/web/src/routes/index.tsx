import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { buttonVariants } from '../components/ui/button';
import { featuresQuery, isIdentityEnabled } from '../features/flags';
import { PingPanel } from '../features/ping/PingPanel';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  const features = useQuery(featuresQuery);
  return (
    <div className="grid w-full gap-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">CognitiveDAG</h1>
        <p className="text-muted-foreground">Orquestador de workflows con IA.</p>
        {isIdentityEnabled(features.data) && (
          <div className="mt-4">
            <Link to="/register" className={buttonVariants()}>
              Crear cuenta
            </Link>
          </div>
        )}
      </section>
      <PingPanel />
    </div>
  );
}
