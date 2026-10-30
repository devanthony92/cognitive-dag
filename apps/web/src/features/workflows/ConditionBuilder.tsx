import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  CONDITION_MAX_DEPTH,
  CONDITION_MAX_OPERATIONS,
  resolveReference,
  type Condition,
  type DagDefinition,
  type DagType,
  type LiteralOperand,
  type Operand,
  type ReferenceScope,
} from '@cognitive-dag/dag-schema';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import {
  COMPARISON_OPS,
  OP_LABELS,
  STRING_LITERAL,
  addChild,
  changeOp,
  defaultCondition,
  fits,
  harmonize,
  isComparison,
  literalFor,
  operandAccepts,
  operandType,
  removeAt,
  replaceAt,
  type OpChoice,
} from './condition-model';
import { ReferenceSelect } from './ReferenceSelect';
import { referenceOptions, referenceScope, type ReferenceOption } from './references';

interface Props {
  value: Condition;
  /** The node that owns the condition: only fields of its ancestors can be chosen. */
  nodeId: string;
  definition: DagDefinition;
  /** Messages of the shared validator for the whole condition. */
  messages: string[];
  onChange: (condition: Condition) => void;
}

interface Context {
  root: Condition;
  scope: ReferenceScope;
  options: readonly ReferenceOption[];
  onChange: (condition: Condition) => void;
}

const OP_ORDER: OpChoice[] = [...COMPARISON_OPS, 'in', 'exists', 'and', 'or', 'not'];

const LITERAL_TYPES: Array<[LiteralOperand['type'], string]> = [
  ['string', 'Texto'],
  ['number', 'Número'],
  ['boolean', 'Sí / No'],
  ['datetime', 'Fecha y hora'],
];

const nameOf = (path: readonly number[]) =>
  path.length === 0 ? 'Condición' : `Condición ${path.map((i) => i + 1).join('.')}`;

/**
 * Visual builder for `logic.condition`. It edits the typed tree of `dag-schema` directly (the
 * only thing that is stored), offers only fields the validator accepts for each operation, and
 * stops adding at depth 5 and 20 operations. Nothing here evaluates anything.
 */
export function ConditionBuilder({ value, nodeId, definition, messages, onChange }: Props) {
  const scope = useMemo(() => referenceScope(definition, nodeId), [definition, nodeId]);
  const options = useMemo(
    () => referenceOptions(definition, nodeId, () => true),
    [definition, nodeId],
  );
  const context: Context = { root: value, scope, options, onChange };

  // Messages the operands already show next to themselves are not repeated below.
  const local = new Set(collectOperandProblems(value, scope));
  const rest = messages.filter((message) => !local.has(message));

  return (
    <div className="grid gap-2">
      <ConditionNode condition={value} path={[]} context={context} />
      <p className="text-xs text-muted-foreground">
        Máximo {CONDITION_MAX_OPERATIONS} operaciones y {CONDITION_MAX_DEPTH} niveles de anidación.
      </p>
      {rest.map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}

function operandsOf(condition: Condition): Operand[] {
  switch (condition.op) {
    case 'and':
    case 'or':
    case 'not':
      return [];
    case 'exists':
      return [condition.operand];
    case 'in':
      return [condition.value];
    default:
      return [condition.left, condition.right];
  }
}

function collectOperandProblems(condition: Condition, scope: ReferenceScope): string[] {
  const problems: string[] = [];
  const visit = (c: Condition) => {
    if (c.op === 'and' || c.op === 'or') c.operands.forEach(visit);
    else if (c.op === 'not') visit(c.operand);
    for (const operand of operandsOf(c)) {
      if (operand.kind !== 'ref' || operand.path === '') continue;
      const resolved = resolveReference(operand.path, scope);
      if (!resolved.ok) problems.push(resolved.message);
    }
  };
  visit(condition);
  return problems;
}

function ConditionNode({
  condition,
  path,
  context,
}: {
  condition: Condition;
  path: number[];
  context: Context;
}) {
  const { root, onChange } = context;
  const name = nameOf(path);
  const set = (next: Condition) => onChange(replaceAt(root, path, next));
  const isGroup = condition.op === 'and' || condition.op === 'or';
  const blockedAdd = (child: Condition) =>
    !fits(isGroup ? addChild(root, path, child) : root)
      ? 'Se alcanzó el límite de la condición.'
      : undefined;
  // New comparisons start on the first field that can be compared, with a literal of its type.
  const seed = context.options.find((option) => operandAccepts('eq')(option.type))?.path ?? '';
  const newLeaf = harmonize(defaultCondition('eq', seed), context.scope);
  const newGroup: Condition = { op: 'and', operands: [newLeaf] };

  return (
    <div role="group" aria-label={name} className="grid gap-2 rounded-md border bg-background p-2">
      <NativeSelect
        aria-label={`Operación de ${name}`}
        value={condition.op}
        onChange={(event) => {
          const next = changeOp(condition, event.target.value as OpChoice);
          const candidate = replaceAt(root, path, harmonize(next, context.scope));
          if (fits(candidate)) onChange(candidate);
        }}
      >
        {OP_ORDER.map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </NativeSelect>

      {isComparison(condition.op) && 'left' in condition && (
        <ComparisonRows condition={condition} name={name} context={context} set={set} />
      )}
      {condition.op === 'exists' && (
        <OperandEditor
          name={`${name} · campo`}
          operand={condition.operand}
          other={undefined}
          accept={operandAccepts('exists')}
          allowLiteral={false}
          context={context}
          onChange={(operand) =>
            set({ op: 'exists', operand: operand as typeof condition.operand })
          }
        />
      )}
      {condition.op === 'in' && (
        <InRows condition={condition} name={name} context={context} set={set} />
      )}

      {condition.op === 'not' && (
        <div className="ml-3 border-l pl-3">
          <ConditionNode condition={condition.operand} path={[...path, 0]} context={context} />
        </div>
      )}

      {(condition.op === 'and' || condition.op === 'or') && (
        <div className="grid gap-2">
          {condition.operands.map((child, index) => (
            <div key={index} className="ml-3 flex items-start gap-1 border-l pl-3">
              <div className="min-w-0 flex-1">
                <ConditionNode condition={child} path={[...path, index]} context={context} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label={`Quitar ${nameOf([...path, index])}`}
                disabled={condition.operands.length <= 1}
                onClick={() => onChange(removeAt(root, [...path, index]))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <div className="ml-3 flex flex-wrap gap-2 pl-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Agregar comparación a ${name}`}
              disabled={blockedAdd(newLeaf) !== undefined}
              title={blockedAdd(newLeaf)}
              onClick={() => onChange(addChild(root, path, newLeaf))}
            >
              <Plus aria-hidden />
              Comparación
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Agregar grupo a ${name}`}
              disabled={blockedAdd(newGroup) !== undefined}
              title={blockedAdd(newGroup)}
              onClick={() => onChange(addChild(root, path, newGroup))}
            >
              <Plus aria-hidden />
              Grupo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonRows({
  condition,
  name,
  context,
  set,
}: {
  condition: Extract<Condition, { left: Operand }>;
  name: string;
  context: Context;
  set: (next: Condition) => void;
}) {
  const { scope } = context;
  const leftType = operandType(condition.left, scope);
  const rightType = operandType(condition.right, scope);
  // A literal on the other side adapts to the field chosen (see `harmonize`), so only a field
  // there restricts which fields are offered.
  const leftConstraint = condition.left.kind === 'ref' ? leftType : undefined;
  const rightConstraint = condition.right.kind === 'ref' ? rightType : undefined;
  const update = (next: Condition) => set(harmonize(next, scope));
  return (
    <div className="grid gap-2">
      <OperandEditor
        name={`${name} · izquierda`}
        operand={condition.left}
        other={rightType}
        accept={operandAccepts(condition.op, rightConstraint)}
        allowLiteral
        enumValues={enumValues(rightType)}
        context={context}
        onChange={(left) => update({ ...condition, left })}
      />
      <OperandEditor
        name={`${name} · derecha`}
        operand={condition.right}
        other={leftType}
        accept={operandAccepts(condition.op, leftConstraint)}
        allowLiteral
        enumValues={enumValues(leftType)}
        context={context}
        onChange={(right) => update({ ...condition, right })}
      />
    </div>
  );
}

function InRows({
  condition,
  name,
  context,
  set,
}: {
  condition: Extract<Condition, { op: 'in' }>;
  name: string;
  context: Context;
  set: (next: Condition) => void;
}) {
  const valueType = operandType(condition.value, context.scope);
  const values = enumValues(valueType);
  return (
    <div className="grid gap-2">
      <OperandEditor
        name={`${name} · valor`}
        operand={condition.value}
        other={undefined}
        accept={operandAccepts('in')}
        allowLiteral
        context={context}
        onChange={(value) => set(harmonize({ ...condition, value }, context.scope))}
      />
      <p className="text-sm font-medium">Opciones</p>
      {condition.options.map((option, index) => (
        <div key={index} className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <OperandEditor
              name={`${name} · opción ${index + 1}`}
              operand={option}
              other={undefined}
              accept={() => false}
              allowLiteral
              literalOnly
              enumValues={values}
              context={context}
              onChange={(next) =>
                set({
                  ...condition,
                  options: condition.options.map((o, i) =>
                    i === index ? (next as LiteralOperand) : o,
                  ),
                })
              }
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Quitar opción ${index + 1} de ${name}`}
            disabled={condition.options.length <= 1}
            onClick={() =>
              set({ ...condition, options: condition.options.filter((_, i) => i !== index) })
            }
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        aria-label={`Agregar opción a ${name}`}
        disabled={condition.options.length >= CONDITION_MAX_OPERATIONS}
        onClick={() =>
          set({
            ...condition,
            options: [...condition.options, literalFor(valueType) ?? { ...STRING_LITERAL }],
          })
        }
      >
        <Plus aria-hidden />
        Opción
      </Button>
    </div>
  );
}

const enumValues = (type: DagType | undefined): string[] | undefined =>
  type?.kind === 'enum' ? type.values : undefined;

interface OperandProps {
  name: string;
  operand: Operand;
  /** Type of the operand on the other side, if known. */
  other: DagType | undefined;
  accept: (type: DagType) => boolean;
  allowLiteral: boolean;
  /** Fixed values to pick from when the other side is an enum. */
  enumValues?: string[] | undefined;
  literalOnly?: boolean;
  context: Context;
  onChange: (operand: Operand) => void;
}

function OperandEditor({
  name,
  operand,
  other,
  accept,
  allowLiteral,
  enumValues: choices,
  literalOnly,
  context,
  onChange,
}: OperandProps) {
  const options = useMemo(
    () => context.options.filter((option) => accept(option.type)),
    [context.options, accept],
  );
  const problem =
    operand.kind === 'ref' && operand.path !== ''
      ? (() => {
          const resolved = resolveReference(operand.path, context.scope);
          return resolved.ok ? undefined : resolved.message;
        })()
      : undefined;

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-start gap-1">
        {allowLiteral && !literalOnly && (
          <NativeSelect
            aria-label={`${name}: origen`}
            className="w-auto"
            value={operand.kind}
            onChange={(event) =>
              onChange(
                event.target.value === 'ref'
                  ? { kind: 'ref', path: '' }
                  : (literalFor(other) ?? { ...STRING_LITERAL }),
              )
            }
          >
            <option value="ref">Campo</option>
            <option value="literal">Valor fijo</option>
          </NativeSelect>
        )}
        {operand.kind === 'ref' ? (
          <div className="min-w-0 flex-1">
            <ReferenceSelect
              label={`${name}: campo`}
              options={options}
              value={operand.path}
              invalid={problem !== undefined}
              onChange={(path) => onChange({ kind: 'ref', path })}
            />
          </div>
        ) : (
          <LiteralEditor name={name} literal={operand} choices={choices} onChange={onChange} />
        )}
      </div>
      {problem && <p className="text-sm text-destructive">{problem}</p>}
    </div>
  );
}

function LiteralEditor({
  name,
  literal,
  choices,
  onChange,
}: {
  name: string;
  literal: LiteralOperand;
  choices: string[] | undefined;
  onChange: (literal: LiteralOperand) => void;
}) {
  const retype = (type: LiteralOperand['type']) =>
    onChange(
      type === 'string'
        ? { ...STRING_LITERAL }
        : (literalFor({ kind: type }, undefined) as LiteralOperand),
    );
  return (
    <>
      <NativeSelect
        aria-label={`${name}: tipo`}
        className="w-auto"
        value={literal.type}
        onChange={(event) => retype(event.target.value as LiteralOperand['type'])}
      >
        {LITERAL_TYPES.map(([type, label]) => (
          <option key={type} value={type}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <div className="min-w-0 flex-1">
        {literal.type === 'boolean' ? (
          <NativeSelect
            aria-label={`${name}: valor`}
            value={String(literal.value)}
            onChange={(event) =>
              onChange({ kind: 'literal', type: 'boolean', value: event.target.value === 'true' })
            }
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
          </NativeSelect>
        ) : literal.type === 'number' ? (
          <NumberInput
            label={`${name}: valor`}
            value={literal.value}
            onChange={(value) => onChange({ kind: 'literal', type: 'number', value })}
          />
        ) : literal.type === 'string' && choices ? (
          <NativeSelect
            aria-label={`${name}: valor`}
            value={literal.value}
            onChange={(event) =>
              onChange({ kind: 'literal', type: 'string', value: event.target.value })
            }
          >
            {!choices.includes(literal.value) && (
              <option value={literal.value}>{literal.value || 'Elige un valor…'}</option>
            )}
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Input
            aria-label={`${name}: valor`}
            placeholder={literal.type === 'datetime' ? '2026-10-30T12:00:00Z' : undefined}
            value={literal.value}
            onChange={(event) =>
              onChange({ kind: 'literal', type: literal.type, value: event.target.value })
            }
          />
        )}
      </div>
    </>
  );
}

/** Keeps what the user typed ("0.", "-") while only complete numbers reach the condition. */
function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);
  return (
    <Input
      aria-label={label}
      type="number"
      step="any"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = Number(event.target.value);
        if (event.target.value.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}
