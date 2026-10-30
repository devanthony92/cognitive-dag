import { X } from 'lucide-react';
import { useRef } from 'react';
import {
  describeType,
  isTextConvertible,
  resolveReference,
  tokenizeTemplate,
  type ReferenceScope,
} from '@cognitive-dag/dag-schema';
import { cn } from '../../lib/utils';
import { NativeSelect } from '../../components/ui/native-select';
import { Textarea } from '../../components/ui/textarea';
import type { ReferenceOption } from './references';

interface Props {
  id: string;
  label: string;
  value: string;
  options: readonly ReferenceOption[];
  scope: ReferenceScope;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
}

interface Chip {
  key: string;
  start: number;
  end: number;
  path: string;
  /** Short name shown on the chip. */
  text: string;
  /** Why the reference is not valid, or undefined when it is. */
  problem: string | undefined;
}

function chipsOf(
  value: string,
  options: readonly ReferenceOption[],
  scope: ReferenceScope,
): Chip[] {
  const chips: Chip[] = [];
  for (const token of tokenizeTemplate(value).tokens) {
    if (token.kind !== 'ref') continue;
    const resolved = resolveReference(token.path, scope);
    const known = options.find((option) => option.path === token.path);
    const problem = !resolved.ok
      ? resolved.message
      : !isTextConvertible(resolved.type)
        ? `Es de tipo ${describeType(resolved.type)} y no se puede escribir dentro de un texto.`
        : undefined;
    chips.push({
      key: `${token.start}`,
      start: token.start,
      end: token.end,
      path: token.path,
      text: known ? `${known.nodeLabel} › ${known.field}` : token.path,
      problem,
    });
  }
  return chips;
}

/**
 * A text field that accepts `{{nodes.<id>.output.<campo>}}` markers (FR-007). Markers are inserted
 * from a list of earlier fields, so the user never types a path, and every marker shows as a chip
 * that is red when the validator would reject it. The text is stored as typed: the markers are
 * plain text that the shared validator checks, never code that anything runs.
 */
export function TemplateEditor({
  id,
  label,
  value,
  options,
  scope,
  invalid,
  describedBy,
  onChange,
  onBlur,
}: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const chips = chipsOf(value, options, scope);

  const insert = (path: string) => {
    const marker = `{{${path}}}`;
    const element = area.current;
    // Without the caret in the field (the user came straight from the list) the marker goes last.
    const focused = element !== null && document.activeElement === element;
    const start = focused ? element.selectionStart : value.length;
    const end = focused ? element.selectionEnd : value.length;
    onChange(`${value.slice(0, start)}${marker}${value.slice(end)}`);
    // Put the caret after the marker once React has written the new text.
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + marker.length, start + marker.length);
    });
  };

  const groups = new Map<string, ReferenceOption[]>();
  for (const option of options) {
    const group = groups.get(option.nodeId);
    if (group) group.push(option);
    else groups.set(option.nodeId, [option]);
  }

  return (
    <div className="grid gap-2">
      <Textarea
        ref={area}
        id={id}
        rows={4}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <NativeSelect
        aria-label={`Insertar referencia en ${label}`}
        value=""
        disabled={options.length === 0}
        onChange={(event) => {
          if (event.target.value) insert(event.target.value);
        }}
      >
        <option value="">
          {options.length === 0
            ? 'Conecta un nodo anterior para insertar referencias'
            : 'Insertar referencia…'}
        </option>
        {[...groups].map(([nodeId, group]) => (
          <optgroup key={nodeId} label={`${group[0]?.nodeLabel ?? nodeId} (${nodeId})`}>
            {group.map((option) => (
              <option key={option.path} value={option.path}>
                {`${option.field} · ${describeType(option.type)}`}
              </option>
            ))}
          </optgroup>
        ))}
      </NativeSelect>
      {chips.length > 0 && (
        <ul aria-label={`Referencias de ${label}`} className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip.key}
              data-invalid={chip.problem !== undefined || undefined}
              title={chip.problem ?? chip.path}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                chip.problem
                  ? 'border-destructive bg-destructive/10 text-destructive'
                  : 'bg-muted text-foreground',
              )}
            >
              <span>{chip.problem ? `${chip.text} (no válida)` : chip.text}</span>
              <button
                type="button"
                aria-label={`Quitar referencia ${chip.text}`}
                className="rounded-full p-0.5 hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChange(`${value.slice(0, chip.start)}${value.slice(chip.end)}`)}
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
