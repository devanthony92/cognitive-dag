import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { NODE_CATALOG, type DagNode } from '@cognitive-dag/dag-schema';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { NativeSelect } from '../../components/ui/native-select';
import { Textarea } from '../../components/ui/textarea';
import {
  describeConfig,
  fromFormValue,
  toFormValue,
  type FieldDescriptor,
  type FormValue,
} from './config-fields';
import type { GroupedErrors } from './model';

type Values = Record<string, FormValue>;

interface Props {
  node: DagNode;
  readOnly: boolean;
  errors: GroupedErrors;
  onChange: (patch: { label?: string; config?: unknown }) => void;
}

const LABEL_KEY = '__label';

/**
 * The form of the side panel, generated from the `configSchema` of the node type. The shared
 * validator (not this form) decides what is valid: it marks the fields through `errors`.
 */
export function ConfigForm({ node, readOnly, errors, onChange }: Props) {
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
        emit({ label: String(values[LABEL_KEY] ?? '') });
        return;
      }
      const descriptor = fields.find((d) => d.key === name);
      if (!descriptor) return;
      const parsed = fromFormValue(descriptor, values[name] ?? '');
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
  const labelMessages = errors.fieldMessages(node.id, 'label');

  return (
    <fieldset disabled={readOnly} className="grid gap-4">
      <div className="text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{entry.label}</p>
        <p>{entry.description}</p>
        <p className="mt-1 font-mono text-xs">{node.id}</p>
      </div>

      <Controller
        control={form.control}
        name={LABEL_KEY}
        render={({ field }) => (
          <FieldRow id={`${node.id}-label`} label="Nombre del nodo" messages={labelMessages}>
            <Input
              id={`${node.id}-label`}
              aria-invalid={labelMessages.length > 0}
              {...field}
              value={String(field.value ?? '')}
            />
          </FieldRow>
        )}
      />

      {descriptors.map((descriptor) => (
        <Controller
          key={descriptor.key}
          control={form.control}
          name={descriptor.key}
          render={({ field, fieldState }) => {
            const messages = [
              ...(fieldState.error?.message ? [fieldState.error.message] : []),
              ...errors.fieldMessages(node.id, `config.${descriptor.key}`),
            ];
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
      ))}
    </fieldset>
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
