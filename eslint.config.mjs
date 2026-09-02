import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'reports/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
      'docs/site/**',
      'docs/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: false, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      /*
       * Turned off deliberately. The rule flags a type parameter that appears
       * only in the return position — but that is exactly the shape of a
       * payload reader: `response.json<User>()` exists so the *caller* names
       * the type it expects. Every HTTP client, Playwright's own included,
       * uses this pattern, and following the rule would replace it with casts
       * at every call site.
       */
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },

  {
    /* Playwright resolves a fixture's dependencies by reading its parameter
     * destructuring, so a fixture with no dependencies must be written as
     * `async ({}, use)`. The core rule cannot know that. */
    files: ['src/fixtures/**/*.ts'],
    rules: {
      'no-empty-pattern': 'off',
    },
  },

  {
    files: ['tests/**/*.ts'],
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/expect-expect': [
        'error',
        { assertFunctionNames: ['expectResponse', 'expectSchema'] },
      ],
      /*
       * Conditional skips are allowed. `test.skip(condition, reason)` is how a
       * suite says "this cannot run right now, and here is why" — an exhausted
       * API quota, an absent OpenAPI document, a role with no credentials.
       * An *unconditional* skip is still flagged, because that is a disabled
       * test pretending to be a passing one.
       */
      'playwright/no-skipped-test': ['warn', { allowConditional: true }],
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  prettier,
);
