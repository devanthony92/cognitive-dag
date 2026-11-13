import { CategoryIcon } from '../../components/category/CategoryIcon';
import {
  NODE_CATALOG,
  NODE_TYPES,
  type NodeCategory,
  type NodeType,
} from '@cognitive-dag/dag-schema';

export const PALETTE_DRAG_TYPE = 'application/x-cognitive-dag-node';

const CATEGORIES: { id: NodeCategory; title: string }[] = [
  { id: 'trigger', title: 'Disparadores' },
  { id: 'llm', title: 'IA (LLM)' },
  { id: 'logic', title: 'Lógica' },
  { id: 'human', title: 'Intervención humana' },
  { id: 'integration', title: 'Integraciones' },
  { id: 'mock', title: 'Pruebas' },
];

/** The 11 node types, grouped; click or drag one onto the canvas to add it. */
export function Palette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  return (
    <aside
      aria-label="Paleta de nodos"
      className="w-60 shrink-0 overflow-y-auto border-r border-line bg-surface p-3 max-md:w-full max-md:border-r-0 max-md:p-0"
    >
      {CATEGORIES.map(({ id, title }) => {
        const types = NODE_TYPES.filter((type) => NODE_CATALOG[type].category === id);
        if (types.length === 0) return null;
        return (
          <section key={id} className="mb-4">
            <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {title}
            </h2>
            <div className="grid gap-1.5">
              {types.map((type) => {
                const entry = NODE_CATALOG[type];
                return (
                  <button
                    key={type}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(PALETTE_DRAG_TYPE, type);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onAdd(type)}
                    className="flex min-h-11 items-start gap-3 rounded-md border border-line bg-ground px-2.5 py-2 text-left text-sm outline-none hover:bg-raised"
                  >
                    <CategoryIcon type={type} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block font-medium">{entry.label}</span>
                      <span className="block text-xs text-ink-muted">{entry.description}</span>
                      <span className="mt-1 block text-label font-semibold text-ink-muted">
                        Ejecutable
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </aside>
  );
}
