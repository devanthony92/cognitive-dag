/** Whether this deployment is a demo: set by the build (`VITE_DEMO_NOTICE=true`). */
export function demoNoticeEnabled(): boolean {
  return (import.meta.env.VITE_DEMO_NOTICE as string | undefined) === 'true';
}

/**
 * Warning of the closed demo (F9, US4): there are no backups, so anything stored can be lost, and the
 * free LLM tier may use the content. Nobody should enter real data.
 */
export function DemoNotice() {
  if (!demoNoticeEnabled()) return null;
  return (
    <div
      role="note"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900"
    >
      Demo sin copias de seguridad, solo datos de prueba.
    </div>
  );
}
