import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { DagError } from '@cognitive-dag/dag-schema';

interface Props {
  errors: readonly DagError[];
  labels: ReadonlyMap<string, string>;
  onSelectNode: (id: string) => void;
}

/** Every problem of the draft in one place; the ones about a node link to it. */
export function ProblemsList({ errors, labels, onSelectNode }: Props) {
  return (
    <section
      aria-label="Problemas"
      className="max-h-40 shrink-0 overflow-y-auto border-t bg-card px-4 py-2 text-sm"
    >
      {errors.length === 0 ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <CircleCheck className="size-4 text-emerald-600" aria-hidden />
          Sin problemas
        </p>
      ) : (
        <>
          <p className="mb-1 flex items-center gap-2 font-medium text-destructive">
            <TriangleAlert className="size-4" aria-hidden />
            {errors.length} {errors.length === 1 ? 'problema' : 'problemas'}
          </p>
          <ul className="grid gap-1">
            {errors.map((error, index) => {
              const nodeId = error.location.node ?? error.location.nodes?.[0];
              const where = nodeId ? (labels.get(nodeId) ?? nodeId) : undefined;
              return (
                <li key={`${error.code}-${index}`}>
                  {nodeId ? (
                    <button
                      type="button"
                      onClick={() => onSelectNode(nodeId)}
                      className="text-left underline-offset-2 hover:underline"
                    >
                      <span className="font-medium">{where}: </span>
                      {error.message}
                    </button>
                  ) : (
                    <span>{error.message}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
