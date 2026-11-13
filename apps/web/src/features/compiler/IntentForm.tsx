import { useState } from 'react';
import { COMPILER_INTENT_MAX_CHARS } from '@cognitive-dag/contracts';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';

interface Props {
  initialIntent: string;
  pending: boolean;
  onSubmit: (intent: string) => void;
}

/** The intent in natural language, with a counter of the 2000 characters the API accepts. */
export function IntentForm({ initialIntent, pending, onSubmit }: Props) {
  const [text, setText] = useState(initialIntent);
  // The API counts the intent without its margins, and so does the counter.
  const length = text.trim().length;
  const tooLong = length > COMPILER_INTENT_MAX_CHARS;
  const canSubmit = length > 0 && !tooLong && !pending;

  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(text.trim());
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="compiler-intent">Describe qué quieres automatizar</Label>
        <Textarea
          id="compiler-intent"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-invalid={tooLong}
          aria-describedby="compiler-intent-counter"
          placeholder="Por ejemplo: cuando llegue un correo, clasifícalo como spam o no, archiva el spam y responde el resto."
        />
        <div className="flex items-center justify-between gap-2 text-body-sm">
          <span
            id="compiler-intent-counter"
            className={tooLong ? 'text-state-failed' : 'text-ink-muted'}
          >
            {length} / {COMPILER_INTENT_MAX_CHARS}
          </span>
          {tooLong && (
            <span role="alert" className="text-state-failed">
              Máximo {COMPILER_INTENT_MAX_CHARS} caracteres.
            </span>
          )}
        </div>
      </div>
      <div>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? 'Enviando…' : 'Generar borrador'}
        </Button>
      </div>
    </form>
  );
}
