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
    // and PerformanceMonitor emit cache/persistence trace lines and the
    // human-readable performance report; the rpc integration test states
    // it runs on mocked responses.
    files: [
      'src/cli.ts',
      'src/server.ts',
      'src/database/migrate.ts',
      'src/services/AddressService.ts',
      'src/services/PerformanceMonitor.ts',
      'tests/integration/rpc.test.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // localStorage guard: application code must not touch localStorage raw.
    // Every storage owner follows the guarded-helper convention — reads are
    // try/catch and degrade to null/absent, writes are best-effort and
    // swallow quota/private-mode failures — so a full or storage-blocked
    // browser degrades gracefully instead of crashing the app. The override
    // below lists the modules that legitimately own a storage key family
    // today (see util/storageKeys.ts for the key manifest).
    files: ['src/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'Raw localStorage reference outside the guarded modules. Route access through an allowlisted module that follows the guarded-helper convention (try/catch read -> null, silent best-effort write — see util/themePreference.ts, util/apiBase.ts) or extend the allowlist override in eslint.config.mjs.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'localStorage',
          message:
            'Raw localStorage member access outside the guarded modules. Route access through an allowlisted module that follows the guarded-helper convention (try/catch read -> null, silent best-effort write — see util/themePreference.ts, util/apiBase.ts) or extend the allowlist override in eslint.config.mjs.',
        },
        {
          object: 'globalThis',
          property: 'localStorage',
          message:
            'Raw localStorage member access outside the guarded modules. Route access through an allowlisted module that follows the guarded-helper convention (try/catch read -> null, silent best-effort write — see util/themePreference.ts, util/apiBase.ts) or extend the allowlist override in eslint.config.mjs.',
        },
      ],
    },
  },
  {
    // localStorage allowlist — every file that legitimately touches
    // localStorage today, all via the guarded-helper convention.
    files: [
      'src/themePreference.ts',
      'src/components/RpcConfig.tsx',
      'src/services/backupRestore.ts',
      'src/services/chainReset.ts',
      'src/services/nftMetadata.ts',
      'src/services/searchHistory.ts',
      'src/services/tokenDirectory.ts',
      'src/util/adminAuth.ts',
      'src/util/apiBase.ts',
      'src/util/privateNotes.ts',
      'src/util/units.ts',
      'src/util/watchlist.ts',
      'src/views/Contract/index.tsx',
      'src/views/Home/GettingStarted.tsx',
      'src/views/Home/Landing.tsx',
      'src/views/Sql/index.tsx',
    ],
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
