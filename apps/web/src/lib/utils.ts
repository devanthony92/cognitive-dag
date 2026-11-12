import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows the default Tailwind scale: without this it takes `text-body-sm` for a
 * colour and drops it next to `text-ink`. The names are those of the type, shape and shadow scales
 * of `styles/tokens.css`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'headline', 'title', 'body', 'body-sm', 'label'] }],
      rounded: [{ rounded: ['station'] }],
      shadow: [{ shadow: ['float'] }],
    },
  },
});

/** Joins class names and resolves conflicting Tailwind utilities (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
