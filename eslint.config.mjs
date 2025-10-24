import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
        ecmaVersion: 2024,
        globals: {
          console: 'readonly',
          process: 'readonly',
          Buffer: 'readonly',
          __dirname: 'readonly',
          __filename: 'readonly',
          module: 'readonly',
          require: 'readonly',
          global: 'readonly',
          window: 'readonly',
          document: 'readonly',
          fetch: 'readonly',
          setTimeout: 'readonly',
          clearTimeout: 'readonly',
          setInterval: 'readonly',
          clearInterval: 'readonly',
        },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // TypeScript strict mode rules
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/prefer-const': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/restrict': 'error',

      // General code quality rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'prefer-arrow-callback': 'error',
      'arrow-spacing': 'error',
      'prefer-template': 'error',
      'template-curly-spacing': 'error',
      'object-shorthand': 'error',
      'quote-props': ['error', 'as-needed'],

      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // React Refresh rules
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // Stylistic rules for consistency
      '@typescript-eslint/brace-style': ['error', '1tbs'],
      '@typescript-eslint/comma-dangle': ['error', 'always-multiline'],
      '@typescript-eslint/func-call-spacing': 'error',
      '@typescript-eslint/indent': ['error', 2],
      '@typescript-eslint/keyword-spacing': 'error',
      '@typescript-eslint/no-extra-parens': 'error',
      '@typescript-eslint/no-extra-semi': 'error',
      '@typescript-eslint/object-curly-spacing': ['error', 'always'],
      '@typescript-eslint/quotes': ['error', 'single'],
      '@typescript-eslint/semi': ['error', 'always'],
      '@typescript-eslint/space-before-function-paren': 'error',
      '@typescript-eslint/space-in-parens': 'error',
      '@typescript-eslint/space-infix-ops': 'error',
      '@typescript-eslint/space-unary-ops': 'error',

      // Performance related rules
      'no-loop-func': 'error',
      'no-inner-declarations': 'error',
      'no-return-assign': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unused-expressions': 'error',

      // Security rules
      'no-script-url': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      '*.min.js',
      '*.min.css',
      '.git/**',
      '.DS_Store',
      'Thumbs.db',
      '*.log',
      '.env*',
      'data/**',
    ],
  },
];