import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import type { KeyValueRow, TypedField } from './config-fields';

/** Messages for a part of the list, by path relative to the field: `''`, `'0'`, `'0.name'`. */
export interface ListMessages {
  /** Errors of the whole list (duplicates, too few items). */
  list: string[];
  /** Errors of an item or one of its parts, including the parts below it. */
  at: (path: string) => string[];
}

const move = <T,>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
};

function Messages({ messages }: { messages: string[] }) {
  return (
    <>
      {messages.map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </>
  );
}

function RowButtons({
  label,
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  label: string;
  index: number;
  count: number;
  disabled?: boolean;
  onMove?: (to: number) => void;
  onRemove: () => void;
}) {
  const name = `${label} ${index + 1}`;
  return (
    <>
      {onMove && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Subir ${name}`}
            disabled={disabled || index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Bajar ${name}`}
            disabled={disabled || index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown aria-hidden />
          </Button>
        </>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Quitar ${name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </>
  );
}

function AddButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-fit"
      aria-label={`Agregar a ${label}`}
      disabled={disabled}
      onClick={onClick}
    >
      <Plus aria-hidden />
      Agregar
    </Button>
  );
}

interface StringListProps {
  id: string;
  label: string;
  items: string[];
  messages: ListMessages;
  disabled?: boolean;
  onChange: (items: string[]) => void;
}

/** A list of texts: one input per item, with add, remove and reorder. */
export function StringListEditor({
  id,
  label,
  items,
  messages,
  disabled,
  onChange,
}: StringListProps) {
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="grid gap-2">
      {items.map((item, index) => {
        const problems = messages.at(String(index));
        return (
          <div key={index} className="grid gap-1">
            <div className="flex items-center gap-1">
              <Input
                aria-label={`${label} ${index + 1}`}
                aria-invalid={problems.length > 0}
                value={item}
                disabled={disabled}
                onChange={(event) =>
                  onChange(items.map((old, at) => (at === index ? event.target.value : old)))
                }
              />
              <RowButtons
                label={label}
                index={index}
                count={items.length}
                disabled={disabled}
                onMove={(to) => onChange(move(items, index, to))}
                onRemove={() => onChange(items.filter((_, at) => at !== index))}
              />
            </div>
            <Messages messages={problems} />
          </div>
        );
      })}
      <Messages messages={messages.list} />
      <AddButton label={label} disabled={disabled} onClick={() => onChange([...items, ''])} />
    </div>
  );
}

const SCALARS = ['string', 'number', 'boolean', 'datetime'] as const;
const KIND_LABELS: Record<string, string> = {
  string: 'Texto',
  number: 'Número',
  boolean: 'Booleano',
  datetime: 'Fecha y hora',
  enum: 'Enumeración',
  list: 'Lista',
  object: 'Objeto',
};

const kindOf = (type: Record<string, unknown>): string =>
  typeof type['kind'] === 'string' ? type['kind'] : 'string';

const isScalar = (kind: string) => (SCALARS as readonly string[]).includes(kind);

/** Types this editor can change. Objects and lists of them are kept as they are. */
function isEditable(type: Record<string, unknown>): boolean {
  const kind = kindOf(type);
  if (isScalar(kind) || kind === 'enum') return true;
  if (kind !== 'list') return false;
  const item = type['item'];
  return (
    typeof item === 'object' && item !== null && isScalar(kindOf(item as Record<string, unknown>))
  );
}

function TypeEditor({
  id,
  label,
  type,
  messages,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  type: Record<string, unknown>;
  messages: string[];
  disabled?: boolean;
  onChange: (type: Record<string, unknown>) => void;
}) {
  const kind = kindOf(type);
  const editable = isEditable(type);
  const kinds = [...SCALARS, 'enum', 'list'];

  if (!editable) {
    return (
      <NativeSelect aria-label={`${label}: tipo`} value={kind} disabled>
        <option value={kind}>{KIND_LABELS[kind] ?? kind} (no editable aquí)</option>
      </NativeSelect>
    );
  }

  const values = Array.isArray(type['values']) ? (type['values'] as string[]) : [];
  const item = (type['item'] ?? { kind: 'string' }) as Record<string, unknown>;
  return (
    <div className="grid gap-1.5">
      <NativeSelect
        aria-label={`${label}: tipo`}
        aria-invalid={messages.length > 0}
        value={kind}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          if (next === 'enum') onChange({ kind: 'enum', values: [] });
          else if (next === 'list') onChange({ kind: 'list', item: { kind: 'string' } });
          else onChange({ kind: next });
        }}
      >
        {kinds.map((option) => (
          <option key={option} value={option}>
            {KIND_LABELS[option]}
          </option>
        ))}
      </NativeSelect>
      {kind === 'enum' && (
        <div className="grid gap-1">
          <span id={`${id}-values-label`} className="text-xs text-muted-foreground">
            Valores permitidos
          </span>
          <StringListEditor
            id={`${id}-values`}
            label={`${label}: valores`}
            items={values}
            disabled={disabled}
            messages={{ list: [], at: () => [] }}
            onChange={(next) => onChange({ kind: 'enum', values: next })}
          />
        </div>
      )}
      {kind === 'list' && (
        <NativeSelect
          aria-label={`${label}: elementos`}
          value={kindOf(item)}
          disabled={disabled}
          onChange={(event) => onChange({ kind: 'list', item: { kind: event.target.value } })}
        >
          {SCALARS.map((option) => (
            <option key={option} value={option}>
              {KIND_LABELS[option]}
            </option>
          ))}
        </NativeSelect>
      )}
      <Messages messages={messages} />
    </div>
  );
}

interface FieldListProps {
  id: string;
  label: string;
  items: TypedField[];
  messages: ListMessages;
  disabled?: boolean;
  onChange: (items: TypedField[]) => void;
}

/** Declared fields (trigger inputs, extracted fields): a name and a type per row. */
export function FieldListEditor({
  id,
  label,
  items,
  messages,
  disabled,
  onChange,
}: FieldListProps) {
  const update = (index: number, patch: Partial<TypedField>) =>
    onChange(items.map((old, at) => (at === index ? { ...old, ...patch } : old)));
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="grid gap-3">
      {items.map((item, index) => {
        const name = `${label} ${index + 1}`;
        const nameProblems = messages.at(`${index}.name`);
        const typeProblems = messages.at(`${index}.type`);
        const rowProblems = messages
          .at(String(index))
          .filter((message) => ![...nameProblems, ...typeProblems].includes(message));
        return (
          <div key={index} className="grid gap-1.5 rounded-md border p-2">
            <div className="flex items-center gap-1">
              <Input
                aria-label={`${name}: nombre`}
                aria-invalid={nameProblems.length > 0}
                placeholder="nombre"
                value={item.name}
                disabled={disabled}
                onChange={(event) => update(index, { name: event.target.value })}
              />
              <RowButtons
                label={label}
                index={index}
                count={items.length}
                disabled={disabled}
                onMove={(to) => onChange(move(items, index, to))}
                onRemove={() => onChange(items.filter((_, at) => at !== index))}
              />
            </div>
            <Messages messages={nameProblems} />
            <TypeEditor
              id={`${id}-${index}`}
              label={name}
              type={item.type}
              messages={typeProblems}
              disabled={disabled}
              onChange={(type) => update(index, { type })}
            />
            <Messages messages={rowProblems} />
          </div>
        );
      })}
      <Messages messages={messages.list} />
      <AddButton
        label={label}
        disabled={disabled}
        onClick={() => onChange([...items, { name: '', type: { kind: 'string' } }])}
      />
    </div>
  );
}

interface KeyValueProps {
  id: string;
  label: string;
  items: KeyValueRow[];
  messages: ListMessages;
  disabled?: boolean;
  onChange: (items: KeyValueRow[]) => void;
}

/** A map of text to text (HTTP headers): a name and a value per row. */
export function KeyValueEditor({ id, label, items, messages, disabled, onChange }: KeyValueProps) {
  const update = (index: number, patch: Partial<KeyValueRow>) =>
    onChange(items.map((old, at) => (at === index ? { ...old, ...patch } : old)));
  const problems = messages.at('');
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="grid gap-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          <Input
            aria-label={`${label} ${index + 1}: nombre`}
            aria-invalid={problems.length > 0}
            placeholder="nombre"
            value={item.key}
            disabled={disabled}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <Input
            aria-label={`${label} ${index + 1}: valor`}
            aria-invalid={problems.length > 0}
            placeholder="valor"
            value={item.value}
            disabled={disabled}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <RowButtons
            label={label}
            index={index}
            count={items.length}
            disabled={disabled}
            onRemove={() => onChange(items.filter((_, at) => at !== index))}
          />
        </div>
      ))}
      <Messages messages={problems} />
      <AddButton
        label={label}
        disabled={disabled}
        onClick={() => onChange([...items, { key: '', value: '' }])}
      />
    </div>
  );
}
