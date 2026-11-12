import { FlaskConical, GitBranch, Globe, Sparkles, UserCheck, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Node categories of the design (design contract §2). The catalog groups its types by prefix. */
export const CATEGORY_IDS = ['trigger', 'logic', 'llm', 'http', 'approval', 'mock'] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface Category {
  /** Spanish name shown next to the pictogram. */
  label: string;
  Icon: LucideIcon;
  /** Token of the line colour, as full class names so Tailwind generates them. */
  textClass: `text-node-${CategoryId}`;
  borderClass: `border-node-${CategoryId}`;
}

export const CATEGORIES: Record<CategoryId, Category> = {
  trigger: {
    label: 'Disparador',
    Icon: Zap,
    textClass: 'text-node-trigger',
    borderClass: 'border-node-trigger',
  },
  logic: {
    label: 'Lógica',
    Icon: GitBranch,
    textClass: 'text-node-logic',
    borderClass: 'border-node-logic',
  },
  llm: { label: 'LLM', Icon: Sparkles, textClass: 'text-node-llm', borderClass: 'border-node-llm' },
  http: {
    label: 'HTTP',
    Icon: Globe,
    textClass: 'text-node-http',
    borderClass: 'border-node-http',
  },
  approval: {
    label: 'Aprobación humana',
    Icon: UserCheck,
    textClass: 'text-node-approval',
    borderClass: 'border-node-approval',
  },
  mock: {
    label: 'Simulado',
    Icon: FlaskConical,
    textClass: 'text-node-mock',
    borderClass: 'border-node-mock',
  },
};

/** Prefix of a node type (`llm.classify` -> `llm`) to its category. */
const BY_PREFIX: Record<string, CategoryId> = {
  trigger: 'trigger',
  logic: 'logic',
  llm: 'llm',
  http: 'http',
  human: 'approval',
  mock: 'mock',
};

/** Category of a node type, or undefined for a prefix the design does not know yet. */
export function categoryOfType(type: string): CategoryId | undefined {
  const prefix = type.split('.')[0] ?? '';
  return Object.hasOwn(BY_PREFIX, prefix) ? BY_PREFIX[prefix] : undefined;
}
