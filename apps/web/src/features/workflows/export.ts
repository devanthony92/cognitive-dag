import type { DagDefinition } from '@cognitive-dag/dag-schema';

/** The definition as the file the user downloads: the same JSON the API stores, readable. */
export function serializeDefinition(definition: DagDefinition): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

/** `Reembolsos de Mayo` → `reembolsos-de-mayo.json`; with a version, `reembolsos-de-mayo-v2.json`. */
export function exportFileName(workflowName: string, versionNumber?: number): string {
  const slug = workflowName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const base = slug === '' ? 'workflow' : slug;
  return `${base}${versionNumber === undefined ? '' : `-v${versionNumber}`}.json`;
}

/** Hands the file to the browser. Nothing leaves the page: the data never goes to a server. */
export function downloadDefinition(definition: DagDefinition, fileName: string): void {
  const blob = new Blob([serializeDefinition(definition)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
