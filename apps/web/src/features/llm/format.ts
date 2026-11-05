/** Estimated cost from millionths of a dollar: "US$ 0,0004" when small, two decimals from a cent up. */
export function formatCostUsd(microUsd: number): string {
  const dollars = Math.max(0, microUsd) / 1_000_000;
  return new Intl.NumberFormat('es', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: dollars >= 0.01 || dollars === 0 ? 2 : 6,
  })
    .format(dollars)
    .replaceAll(' ', ' ');
}

export const formatTokens = (tokens: number): string => tokens.toLocaleString('es');

/** The model's own estimate of its certainty, as a percentage; undefined when it is not a number in [0, 1]. */
export function confidenceText(output: unknown): string | undefined {
  if (typeof output !== 'object' || output === null) return undefined;
  const value = (output as Record<string, unknown>)['confidence'];
  if (typeof value !== 'number' || value < 0 || value > 1) return undefined;
  return `${Math.round(value * 100)} %`;
}
