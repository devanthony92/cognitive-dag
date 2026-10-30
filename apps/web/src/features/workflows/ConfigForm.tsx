import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  NODE_CATALOG,
  isTextConvertible,
  type Condition,
  type DagDefinition,
  type DagNode,
} from '@cognitive-dag/dag-schema';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { NativeSelect } from '../../components/ui/native-select';
import { Textarea } from '../../components/ui/textarea';
import {
  describeConfig,
  fromFormValue,
  toFormValue,
  type FieldDescriptor,
  type KeyValueRow,
  type TypedField,
  type FormValue,
} from './config-fields';
import {
  FieldListEditor,
  KeyValueEditor,
  StringListEditor,
  type ListMessages,
} from './ListEditors';
import { ConditionBuilder } from './ConditionBuilder';
import { defaultCondition, looksLikeCondition } from './condition-model';
import type { GroupedErrors } from './model';
import { referenceOptions, referenceScope } from './references';
import { TemplateEditor } from './TemplateEditor';

type Values = Record<string, FormValue>;

interface Props {
  node: DagNode;
  /** The whole graph: references can only point to fields of this node's ancestors. */
  definition: DagDefinition;
  readOnly: boolean;
  errors: GroupedErrors;
  onChange: (patch: { label?: string; config?: unknown }) => void;
  /** Renames the node and everything that points to it; returns why it cannot, if it cannot. */
  onRename: (id: string) => string | undefined;
}

const LABEL_KEY = '__label';

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The form of the side panel, generated from the `configSchema` of the node type. The shared
 * validator (not this form) decides what is valid: it marks the fields through `errors`.
 */
export function ConfigForm({ node, definition, readOnly, errors, onChange, onRename }: Props) {
  const descriptors = useMemo(() => describeConfig(node.type), [node.type]);
  const config = (
    typeof node.config === 'object' && node.config !== null ? node.config : {}
  ) as Record<string, unknown>;

  const form = useForm<Values>({
    defaultValues: {
      [LABEL_KEY]: node.label,
      ...Object.fromEntries(descriptors.map((d) => [d.key, toFormValue(d, config[d.key])])),
    },
  });

  // The latest props, read from the subscription without resubscribing on every keystroke.
  const latest = useMemo(() => ({ node, descriptors, onChange }), [node, descriptors, onChange]);
  useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      if (name === undefined) return;
      const { node: current, descriptors: fields, onChange: emit } = latest;
      if (name === LABEL_KEY) {
        emit({ label: asText(values[LABEL_KEY]) });
        return;
      }
      const descriptor = fields.find((d) => d.key === name);
      if (!descriptor) return;
      const parsed = fromFormValue(descriptor, (values[name] as FormValue | undefined) ?? '');
      if (!parsed.ok) {
        form.setError(name, { type: 'json', message: 'JSON no válido.' });
        return;
      }
      form.clearErrors(name);
      const next = { ...(current.config as Record<string, unknown>) };
      if (parsed.value === undefined) delete next[name];
      else next[name] = parsed.value;
      emit({ config: next });
    });
    return () => subscription.unsubscribe();
  }, [form, latest]);

  const entry = NODE_CATALOG[node.type];
  const scope = useMemo(() => referenceScope(definition, node.id), [definition, node.id]);
  const textOptions = useMemo(
    () => referenceOptions(definition, node.id, isTextConvertible),
    [definition, node.id],
  );
  const labelMessages = errors.fieldMessages(node.id, 'label');

  return (
    <fieldset disabled={readOnly} className="grid gap-4">
      <div className="text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{entry.label}</p>
        <p>{entry.description}</p>
      </div>

      <IdentifierField id={node.id} onRename={onRename} />

      <Controller
        control={form.control}
        name={LABEL_KEY}
        render={({ field }) => (
          <FieldRow id={`${node.id}-label`} label="Nombre del nodo" messages={labelMessages}>
            <Input
              id={`${node.id}-label`}
              aria-invalid={labelMessages.length > 0}
              {...field}
              value={asText(field.value)}
            />
          </FieldRow>
        )}
      />

      {descriptors.map((descriptor) =>
        descriptor.kind === 'condition' ? (
          <ListRow
            key={descriptor.key}
            id={`${node.id}-${descriptor.key}`}
            label={descriptor.label}
          >
            {looksLikeCondition(config[descriptor.key]) ? (
              <ConditionBuilder
                value={config[descriptor.key] as Condition}
                nodeId={node.id}
                definition={definition}
                messages={errors.fieldMessages(node.id, `config.${descriptor.key}`)}
                onChange={(condition) =>
                  onChange({ config: { ...config, [descriptor.key]: condition } })
                }
              />
            ) : (
              <div className="grid gap-2">
                <p className="text-sm text-destructive">
                  La condición guardada no tiene un formato que el constructor pueda mostrar.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() =>
                    onChange({
                      config: {
                        ...config,
                        [descriptor.key]: defaultCondition('eq', firstPath(textOptions)),
                      },
                    })
                  }
                >
                  Empezar una condición nueva
                </Button>
              </div>
            )}
          </ListRow>
        ) : (
          <Controller
            key={descriptor.key}
            control={form.control}
            name={descriptor.key}
            render={({ field, fieldState }) => {
              const id = `${node.id}-${descriptor.key}`;
              const path = `config.${descriptor.key}`;
              const list: ListMessages = {
                list: errors.exactMessages(node.id, path),
                at: (rel) => errors.fieldMessages(node.id, rel ? `${path}.${rel}` : path),
              };
              if (descriptor.kind === 'string-list') {
                return (
                  <ListRow id={id} label={descriptor.label}>
                    <StringListEditor
                      id={id}
                      label={descriptor.label}
                      items={field.value as string[]}
                      messages={list}
                      onChange={field.onChange}
                    />
                  </ListRow>
                );
              }
              if (descriptor.kind === 'field-list') {
                return (
                  <ListRow id={id} label={descriptor.label}>
                    <FieldListEditor
                      id={id}
                      label={descriptor.label}
                      items={field.value as TypedField[]}
                      messages={list}
                      onChange={field.onChange}
                    />
                  </ListRow>
                );
              }
              if (descriptor.kind === 'key-value') {
                return (
                  <ListRow id={id} label={descriptor.label}>
                    <KeyValueEditor
                      id={id}
                      label={descriptor.label}
                      items={field.value as KeyValueRow[]}
                      messages={list}
                      onChange={field.onChange}
                    />
                  </ListRow>
                );
              }
              const messages = [
                ...(fieldState.error?.message ? [fieldState.error.message] : []),
                ...errors.fieldMessages(node.id, `config.${descriptor.key}`),
              ];
              if (descriptor.kind === 'template') {
                return (
                  <FieldRow id={id} label={descriptor.label} messages={messages}>
                    <TemplateEditor
                      id={id}
                      label={descriptor.label}
                      value={typeof field.value === 'string' ? field.value : ''}
                      options={textOptions}
                      scope={scope}
                      invalid={messages.length > 0}
                      describedBy={messages.length > 0 ? `${id}-message` : undefined}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FieldRow>
                );
              }
              return (
                <FieldRow
                  id={`${node.id}-${descriptor.key}`}
                  label={descriptor.label}
                  messages={messages}
                >
                  <FieldControl
                    id={`${node.id}-${descriptor.key}`}
                    descriptor={descriptor}
                    value={field.value}
                    invalid={messages.length > 0}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                </FieldRow>
              );
            }}
          />
        ),
      )}
    </fieldset>
  );
}

/** Caption of a list editor; the editor itself is a group named by it. */
function ListRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span id={`${id}-label`} className="text-sm leading-none font-medium">
        {label}
      </span>
      {children}
    </div>
  );
}

function FieldRow({
  id,
  label,
  messages,
  children,
}: {
  id: string;
  label: string;
  messages: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {messages.map((message) => (
        <p key={message} id={`${id}-message`} className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}

function FieldControl({
  id,
  descriptor,
  value,
  invalid,
  onChange,
  onBlur,
}: {
  id: string;
  descriptor: FieldDescriptor;
  value: FormValue | undefined;
  invalid: boolean;
  onChange: (value: FormValue) => void;
  onBlur: () => void;
}) {
  const common = {
    id,
    'aria-invalid': invalid,
    'aria-describedby': invalid ? `${id}-message` : undefined,
    onBlur,
  };
  const text = typeof value === 'string' ? value : '';

  switch (descriptor.kind) {
    case 'select':
      return (
        <NativeSelect {...common} value={text} onChange={(event) => onChange(event.target.value)}>
          {descriptor.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </NativeSelect>
      );
    case 'checkbox':
      return (
        <input
          {...common}
          type="checkbox"
          className="size-4"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      );
    case 'number':
      return (
        <Input
          {...common}
          type="number"
          step={descriptor.integer ? 1 : 'any'}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'textarea':
      return (
        <Textarea {...common} rows={4} value={text} onChange={(e) => onChange(e.target.value)} />
      );
    case 'json':
      return (
        <Textarea
          {...common}
          rows={6}
          spellCheck={false}
          className="font-mono text-xs"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return <Input {...common} value={text} onChange={(event) => onChange(event.target.value)} />;
  }
}

/** First reference offered, used to seed a new condition so its first operand is already a field. */
const firstPath = (options: ReadonlyArray<{ path: string }>): string => options[0]?.path ?? '';

/**
 * The id of a node is what references call it. Changing it rewrites every reference, so it is
 * applied when the user leaves the field or presses Enter, never on each keystroke.
 */
function IdentifierField({
  id,
  onRename,
}: {
  id: string;
  onRename: (id: string) => string | undefined;
}) {
  const [draft, setDraft] = useState(id);
  const [problem, setProblem] = useState<string | undefined>();
  const commit = () => {
    if (draft === id) {
      setProblem(undefined);
      return;
    }
    const why = onRename(draft);
    setProblem(why);
  };
  return (
    <FieldRow id={`${id}-id`} label="Identificador" messages={problem ? [problem] : []}>
      <Input
        id={`${id}-id`}
        className="font-mono text-xs"
        spellCheck={false}
        aria-invalid={problem !== undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      <p className="text-xs text-muted-foreground">
        Las referencias de otros nodos lo usan; al cambiarlo se actualizan solas.
      </p>
    </FieldRow>
  );
}
