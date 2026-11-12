import { describe, expect, it } from 'vitest';
import { NODE_CATALOG, NODE_TYPES } from '@cognitive-dag/dag-schema';
import {
  CATEGORIES,
  CATEGORY_IDS,
  categoryOfType,
  type CategoryId,
} from '../src/components/category/categories';

describe('node categories (design contract §2)', () => {
  it('has the 6 categories of the design, each with pictogram, Spanish label and token', () => {
    expect([...CATEGORY_IDS].sort()).toEqual(
      ['approval', 'http', 'llm', 'logic', 'mock', 'trigger'].sort(),
    );
    for (const id of CATEGORY_IDS) {
      const category = CATEGORIES[id];
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.Icon).toBeDefined();
      expect(category.textClass).toBe(`text-node-${id}`);
      expect(category.borderClass).toBe(`border-node-${id}`);
    }
    expect(CATEGORIES.approval.label).toBe('Aprobación humana');
  });

  it('gives every type of NODE_CATALOG (the 11 current ones) a category', () => {
    expect(NODE_TYPES).toHaveLength(11);
    for (const type of NODE_TYPES) {
      const id = categoryOfType(type);
      expect(id, `${type} has no category`).toBeDefined();
      expect(CATEGORIES[id as CategoryId].label).toBeTruthy();
    }
  });

  it('agrees with the category the catalog declares', () => {
    const FROM_CATALOG = {
      trigger: 'trigger',
      llm: 'llm',
      logic: 'logic',
      human: 'approval',
      integration: 'http',
      mock: 'mock',
    } as const;
    for (const type of NODE_TYPES) {
      expect(categoryOfType(type)).toBe(FROM_CATALOG[NODE_CATALOG[type].category]);
    }
  });

  it('fails for a prefix without a map, so a new family cannot slip in unseen', () => {
    expect(categoryOfType('database.query')).toBeUndefined();
    expect(categoryOfType('')).toBeUndefined();
    const prefixes = new Set(NODE_TYPES.map((type) => type.split('.')[0]));
    expect([...prefixes].sort()).toEqual(['http', 'human', 'llm', 'logic', 'mock', 'trigger']);
  });
});
