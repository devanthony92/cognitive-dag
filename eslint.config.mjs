import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/routeTree.gen.ts',
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.specify/**',
      '**/*.config.*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Constitution, principle I: no dynamic code evaluation.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['apps/web/src/routes/**/*.{ts,tsx}'],
    rules: {
      // TanStack Router redirects are thrown by design.
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      // NestJS dependency injection needs runtime class references for decorated parameters.
      '@typescript-eslint/consistent-type-imports': 'off',
      // Soft delete (research R3): RLS does not hide deleted rows, so reads go through `active`.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^(from|innerJoin|leftJoin|rightJoin|fullJoin)$/][arguments.0.name=/^(users|organizations|memberships)$/]',
          message:
            'Read users, organizations and memberships through `active` from @cognitive-dag/db (soft delete).',
        },
      ],
    },
  },
);
