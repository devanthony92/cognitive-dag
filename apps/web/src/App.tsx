import { PingPanel } from './features/ping/PingPanel';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '2rem auto' }}>
      <h1>CognitiveDAG</h1>
      <p>Orquestador de workflows con IA.</p>
      <PingPanel />
    </main>
  );
}
