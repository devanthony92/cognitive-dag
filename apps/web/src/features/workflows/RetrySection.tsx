import {
  NODE_CATALOG,
  RETRY_FIELD_LABELS,
  RETRY_LIMITS,
  type DagNode,
  type RetrySetting,
} from '@cognitive-dag/dag-schema';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import type { GroupedErrors } from './model';

const KEYS = ['maxAttempts', 'timeoutSeconds', 'initialIntervalMs'] as const;
type Key = (typeof KEYS)[number];

interface Props {
  node: DagNode;
  errors: GroupedErrors;
  onChange: (retry: RetrySetting | undefined) => void;
}

/**
 * Retry settings of a node with an effect (F4, FR-006). What is left empty takes the default of
 * the node type, shown as the placeholder; the shared validator decides what is acceptable and
 * marks the field through `errors`.
 */
export function RetrySection({ node, errors, onChange }: Props) {
  const defaults = NODE_CATALOG[node.type].retryDefaults;
  if (!defaults) return null;
  const current: RetrySetting = node.retry ?? {};

  const update = (key: Key, text: string) => {
    const next: Record<string, number> = { ...current };
    // Empty goes back to the default; anything else is sent as typed so the validator can say why not.
    if (text.trim() === '' || Number.isNaN(Number(text))) delete next[key];
    else next[key] = Number(text);
    onChange(Object.keys(next).length === 0 ? undefined : next);
  };

  const general = errors.exactMessages(node.id, 'retry');

  return (
    <section aria-label="Reintentos" className="grid gap-3 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">Reintentos</h3>
        <p className="text-xs text-muted-foreground">
          Qué tan insistente es este nodo ante un fallo pasajero. Si dejas un campo vacío se usa el
          valor por defecto.
        </p>
      </div>
      {general.map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
      {KEYS.map((key) => {
        const id = `${node.id}-retry-${key}`;
        const messages = errors.fieldMessages(node.id, `retry.${key}`);
        const limits = RETRY_LIMITS[key];
        return (
          <div key={key} className="grid gap-1.5">
            <Label htmlFor={id}>{RETRY_FIELD_LABELS[key]}</Label>
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              step={1}
              placeholder={String(defaults[key])}
              aria-invalid={messages.length > 0}
              aria-describedby={`${id}-hint`}
              value={current[key] === undefined ? '' : String(current[key])}
              onChange={(event) => update(key, event.target.value)}
            />
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              Por defecto {defaults[key]}. Entre {limits.min} y {limits.max}.
            </p>
            {messages.map((message) => (
              <p key={message} className="text-sm text-destructive">
                {message}
              </p>
            ))}
          </div>
        );
      })}
    </section>
  );
}
