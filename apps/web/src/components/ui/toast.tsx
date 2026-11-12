import { Info, X } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { StatusGlyph, STATE_TEXT_CLASS, type ServiceState } from '../status/statusGlyphs';

type Tone = 'info' | 'success' | 'error';

const TONE_STATE: Record<Exclude<Tone, 'info'>, ServiceState> = {
  success: 'succeeded',
  error: 'failed',
};

const TONE_BORDER: Record<Tone, string> = {
  info: 'border-line',
  success: 'border-state-succeeded',
  error: 'border-state-failed',
};

interface Props {
  message: string;
  onClose: () => void;
  /** Milliseconds before it closes by itself. */
  duration?: number;
  /** Adds the glyph and the border of a state; the message always carries the meaning. */
  tone?: Tone;
}

/**
 * A notice that floats over the page, so showing it never moves the layout. It floats, so it casts the
 * floating shadow; on mobile it sits above the bottom bar.
 */
export function Toast({ message, onClose, duration = 5000, tone = 'info' }: Props) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const state = tone === 'info' ? undefined : TONE_STATE[tone];
  return (
    <div
      role="status"
      data-tone={tone}
      className={cn(
        'fixed right-4 bottom-[calc(var(--bottom-bar-height)+1rem)] z-50 flex max-w-sm items-start gap-3 rounded-lg border bg-raised py-2 pr-1 pl-4 text-body text-ink shadow-float md:bottom-4',
        TONE_BORDER[tone],
      )}
    >
      {state ? (
        <StatusGlyph state={state} className={cn('mt-2.5 size-5', STATE_TEXT_CLASS[state])} />
      ) : (
        <Info className="mt-2.5 size-5 shrink-0 text-ink-muted" aria-hidden />
      )}
      <p className="py-2.5">{message}</p>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={onClose}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-surface hover:text-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
