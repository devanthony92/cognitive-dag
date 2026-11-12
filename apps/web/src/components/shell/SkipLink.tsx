/** First stop of the keyboard focus order: jumps over the header and the navigation to the content. */
export function SkipLink({ targetId }: { targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only z-50 rounded-md bg-action px-4 py-3 font-semibold text-on-action focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      Saltar al contenido
    </a>
  );
}
