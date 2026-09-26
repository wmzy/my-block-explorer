# Contributing

A lightweight, local-first EVM block explorer: React 19 + Vite 8 frontend,
Hono + Node 22 backend, DuckDB storage. Two documents govern this repo:

- [AGENTS.md](../AGENTS.md) — the project knowledge base. Authoritative for
  structure, conventions, and per-feature behavior. Mine it before designing.
- [docs/README.md](./README.md) — the maintained docs set (installation,
  config, API, architecture, deployment).

## Prerequisites

- **Node.js 22+** (`engines.node >= 22`).
- **pnpm** — mandatory. npm cannot read pnpm's `node_modules` layout and
  crashes on it; every command below goes through `pnpm`.

## Setup

```bash
pnpm install
pnpm dev        # Vite dev server on http://localhost:3000, Hono API bridged at /api
```

The app has three run modes (RPC-only / local backend / shared deployment) —
see [INSTALLATION.md](./INSTALLATION.md#three-ways-to-run-it).

### Dev topology warnings

- **Never run `pnpm dev` and `pnpm dev:server` together.** Both open the same
  DuckDB files; DuckDB allows a single writer per file. The bridge wins, the
  standalone runs table-less and has been observed "deleting a corrupted WAL".
- **Browser-smoke topology:** run Vite only, and point the app at a manual
  API base (setup screen / settings; persisted in localStorage under
  `my-block-explorer-api-url`) instead of stacking a second backend.
- Backend edits do **not** hot-reload through the Vite bridge — restart
  `pnpm dev` after touching backend files.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server on :3000 (Hono API bridged in-process) |
| `pnpm dev:server` | Standalone API on :8201 (`tsx watch src/cli.ts`) |
| `pnpm build` | Build client (`dist/client`) + server (`dist/server`) |
| `pnpm build:client` / `pnpm build:server` / `pnpm build:pages` | Build pieces; `build:pages` sets `VITE_BASE` for the Pages demo |
| `pnpm start` | Run the built API server (`node dist/server/cli.js`) |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | Drizzle migrations (generate / apply / inspect) |
| `pnpm test` / `pnpm test:unit` / `pnpm test:integration` | Vitest (all / `tests/unit` / `tests/integration`) |
| `pnpm lint` / `pnpm format` / `pnpm typecheck` | ESLint / Prettier / `tsc --noEmit` |

## Testing discipline

- Run **one test file per invocation**: `pnpm vitest run tests/unit/<file>`.
  Positional filters are ANDed — `pnpm vitest run a.test.ts b.test.ts`
  silently matches nothing.
- `pnpm vitest run --changed` scopes a run to changed files.
- Vitest is **transform-only**: green focused tests prove nothing about
  types. Every change — and every parallel work wave — must close with
  `pnpm typecheck`; type errors cluster at module/agent seams that no single
  focused test can see.
- DuckDB is single-writer: db-backed tests that open real database files
  fight over `data/blockchain.db` under parallel forks (and leftover workers
  keep the lock after the suite ends). Mock `@/database/init` instead —
  partial `importOriginal` mock; see `tests/integration/api-routes.test.ts`
  for the pattern.

## Code conventions

Full list: AGENTS.md → CONVENTIONS / ANTI-PATTERNS. The short version:

- TypeScript: `type` over `interface`; strict; **no `as any`, no
  `@ts-ignore`, no `console.log`** (use `console.warn`/`console.error` or
  the pino logger); English-only comments.
- Path alias `@/` → `src/`, but **backend runtime value imports must be
  relative** (esbuild bundles `vite.config.ts` without resolving the alias;
  type-only `@/` imports are stripped and fine).
- React: function components; Linaria `css` + `cx()`; theme via `--haze-*`
  variables; **never alias named haze-ui imports** (`{ Button as B }` breaks
  `vite-plugin-haze-ui`'s scan).
- Backend services follow the `*Service.ts` singleton pattern; frontend data
  hooks live in `src/services/*.ts` on the query layer (`src/util/useQuery.ts`).
- Frontend HTTP goes through `src/util/http.ts` (fetch-fun) with the
  discovered base — service paths **must start with `/api/`** (the base is
  origin-only; a missing prefix 404s forever).
- DuckDB/Drizzle: **no SERIAL** (DuckDB-incompatible) — use composite
  primary keys; datetime strings are naive UTC — parse via `toIsoTimestamp`
  (`src/services/SearchService.ts`), never bare `new Date(str)`; hand-written
  migrations need a meta snapshot or the next `db:generate` re-emits their
  diff; DuckDB rejects `ADD COLUMN NOT NULL` (go nullable + default).

The decisions behind these rules live in [adr/](./adr/README.md).

## Git discipline (shared tree)

This repo is frequently worked by multiple agents/people in parallel on one
working tree:

- Read-only git only: `status`, `diff`, `log`, `show`.
- **Never `git stash` / `checkout` / `restore` / `reset`** on the shared
  tree — they snapshot or roll back everyone's in-flight work. Baseline
  comparisons use read-only means (`git show HEAD:path`, `git diff`).

## Pull requests

A PR is ready when:

1. Focused tests for the changed behavior are green (see testing discipline).
2. `pnpm typecheck` and `pnpm lint` are clean.
3. User-facing changes were verified in a **real browser** (topology above),
   not just jsdom — jsdom suites have historically missed dialog-control and
   mounting-order bugs.
4. New routes/mounts follow [ADR-0008](./adr/0008-route-mounting-discipline.md)
   (integration-owned wiring; gate scoping).
5. Cross-cutting conventions discovered along the way are recorded in
   AGENTS.md — a one-line note in the relevant section beats a new doc.
