import { describeType } from '@cognitive-dag/dag-schema';
import { NativeSelect } from '../../components/ui/native-select';
import type { ReferenceOption } from './references';

interface Props {
  id?: string;
  /** Accessible name of the control. */
  label: string;
  /** Fields the user may pick: ancestors only, already filtered by type. */
  options: readonly ReferenceOption[];
  /** The stored reference path, or '' when none is chosen yet. */
  value: string;
  /** Text of the empty option. */
  placeholder?: string;
  invalid?: boolean;
  onChange: (path: string) => void;
}

/** `nodeId` → its options, keeping the order in which the nodes appear. */
function groupByNode(options: readonly ReferenceOption[]): Map<string, ReferenceOption[]> {
  const groups = new Map<string, ReferenceOption[]>();
  for (const option of options) {
    const group = groups.get(option.nodeId);
    if (group) group.push(option);
    else groups.set(option.nodeId, [option]);
  }
  return groups;
}

/**
 * Picks a field of an earlier node. It only lists what the validator accepts for the place where
 * the reference goes, so a bad reference cannot be built from here. A stored reference that is no
 * longer offered (its node was deleted, its type changed) stays visible and marked, never dropped.
 */
export function ReferenceSelect({
  id,
  label,
  options,
  value,
  placeholder = 'Elige un campo…',
  invalid,
  onChange,
}: Props) {
  const known = options.some((option) => option.path === value);
  return (
    <NativeSelect
      id={id}
      aria-label={label}
      aria-invalid={invalid || (value !== '' && !known) || undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {value !== '' && !known && <option value={value}>{`⚠ ${value} (no válida)`}</option>}
      {[...groupByNode(options)].map(([nodeId, group]) => (
        <optgroup key={nodeId} label={`${group[0]?.nodeLabel ?? nodeId} (${nodeId})`}>
          {group.map((option) => (
            <option key={option.path} value={option.path}>
              {`${option.field} · ${describeType(option.type)}`}
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
  );
}
