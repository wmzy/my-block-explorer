// Single source of truth for the app version the API reports: the
// package.json field (kept in sync with the latest release tag by the
// release workflow's version guard). Resolved lazily at first call, not at
// import time, so a missing file degrades to the literal instead of
// breaking module load.
//
// Two candidate locations cover every layout this code runs in:
// - bundled (dist/server/*.js): ../../package.json — the package root
// - dev (tsx / vite bridge, src/**): ../package.json — the repo root
// A JSON require is also the one place a plain require is still needed
// (import assertions would pin syntax details for no gain here).
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

let cached: string | undefined;

export function appVersion(): string {
  if (cached !== undefined) return cached;
  for (const candidate of ['../../package.json', '../package.json']) {
    try {
      const version: unknown = nodeRequire(candidate)?.version;
      if (typeof version === 'string' && version !== '') {
        cached = version;
        return cached;
      }
    } catch {
      // Candidate not present in this layout — try the next.
    }
  }
  // Unknown rather than a fabricated number: the version chip renders
  // exactly this when it cannot know (and tests can pin the fallback).
  cached = 'unknown';
  return cached;
}
