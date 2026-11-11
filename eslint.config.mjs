import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  stylistic.configs.customize({
    indent: 2,
    quotes: 'single',
    semi: true,
    jsx: true,
  }),
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
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Allow any in test files and for specific internal patterns
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      '@typescript-eslint/no-non-null-assertion': 'off',

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
      'prefer-template': 'error',
      'object-shorthand': 'error',

      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // React Refresh rules
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Stylistic overrides
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/brace-style': 'off', // Conflicts with auto-fix
      '@stylistic/operator-linebreak': 'off', // Conflicts with auto-fix
      '@stylistic/arrow-parens': 'off', // Conflicts with auto-fix
      '@stylistic/multiline-ternary': 'off', // Conflicts with auto-fix
      '@stylistic/jsx-one-expression-per-line': 'off', // Conflicts with auto-fix

      // Performance related rules
      'no-loop-func': 'error',
      'no-inner-declarations': 'error',
      'no-return-assign': 'error',
      'no-sequences': 'error',
      'no-unused-expressions': 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // Console allowlist: files where console output IS the interface.
    // CLI entry points print startup banners and command UX; AddressService
    // emits cache/persistence trace lines; the rpc integration test states
    // it runs on mocked responses.
    files: [
      'src/cli.ts',
      'src/server.ts',
      'src/services/AddressService.ts',
      'tests/integration/rpc.test.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // localStorage guard: application code must not touch localStorage raw.
    // Every storage owner routes through the guarded helpers in
    // util/storageAccess.ts — reads are try/catch and degrade to
    // null/absent, writes are best-effort and swallow quota/private-mode
    // failures — so a full or storage-blocked browser degrades gracefully
    // instead of crashing the app (see util/storageKeys.ts for the key
    // manifest every owner imports its key constant from).
    files: ['src/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'Raw localStorage reference outside the guarded modules. Route access through the helpers in util/storageAccess.ts (try/catch read -> null, silent best-effort write); a new key/prefix constant belongs in util/storageKeys.ts.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'localStorage',
          message:
            'Raw localStorage member access outside the guarded modules. Route access through the helpers in util/storageAccess.ts (try/catch read -> null, silent best-effort write); a new key/prefix constant belongs in util/storageKeys.ts.',
        },
        {
          object: 'globalThis',
          property: 'localStorage',
          message:
            'Raw localStorage member access outside the guarded modules. Route access through the helpers in util/storageAccess.ts (try/catch read -> null, silent best-effort write); a new key/prefix constant belongs in util/storageKeys.ts.',
        },
      ],
    },
  },
  {
    // localStorage allowlist — the only two files that legitimately touch
    // localStorage raw. storageAccess.ts IS the guarded helper; backupRestore
    // enumerates localStorage.length/key(i) for the backup scan (no helper
    // covers enumeration) and its per-key restore loop must catch each
    // write's own error to report it, which writeStorageItem's boolean
    // would swallow.
    files: ['src/services/backupRestore.ts', 'src/util/storageAccess.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    // Test fixtures legitimately widen types to fake viem/drizzle surfaces;
    // `as any` stays visible as a warning there but never blocks CI. Source
    // code (src/**) is held to the strict no-any error.
    files: ['tests/**', 'src/utils/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
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
      // Config files not in tsconfig
      'eslint.config.mjs',
      'prettier.config.mjs',
      'vite.config.ts',
      'drizzle.config.ts',
      // Examples
      'examples/**',
    ],
  },
];
