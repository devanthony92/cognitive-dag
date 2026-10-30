import { X } from 'lucide-react';
import { useEffect } from 'react';

interface Props {
  message: string;
  onClose: () => void;
  /** Milliseconds before it closes by itself. */
  duration?: number;
}

/** A notice that floats over the page, so showing it never moves the layout. */
export function Toast({ message, onClose, duration = 5000 }: Props) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-md border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg"
    >
      <p>{message}</p>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={onClose}
        className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
