/**
 * Shared look of text fields: 44 px tall, 8 px radius, control border at 3:1 (`line-strong`), at least
 * 16 px on mobile so iOS does not zoom, a red border plus the message text when invalid.
 */
export const FIELD_CLASS =
  'w-full min-w-0 rounded-md border border-line-strong bg-ground px-3 text-base text-ink transition-colors duration-(--duration-state) outline-none placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-state-failed md:text-body';
