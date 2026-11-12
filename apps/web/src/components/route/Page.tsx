import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** The three page widths of DESIGN.md: forms and sign-in, lists and settings, and the full canvas. */
export type PageWidth = 'narrow' | 'default' | 'full';

const WIDTH_CLASS: Record<PageWidth, string> = {
  // Narrow content is centred as before: a sign-in card does not hug the left edge.
  narrow: 'max-w-page-narrow flex flex-col items-center px-4 py-8 sm:px-6 md:py-12',
  default: 'max-w-page-default px-4 py-6 sm:px-6 md:py-8',
  full: 'max-w-none',
};

/** Width wrapper of a screen. The route chooses it with `staticData.width`; the shell applies it. */
export function Page({
  width = 'default',
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-width={width} className={cn('mx-auto w-full', WIDTH_CLASS[width], className)}>
      {children}
    </div>
  );
}
