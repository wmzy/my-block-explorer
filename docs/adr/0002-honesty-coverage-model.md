# ADR-0002: Honesty/coverage model — partial is never presented as complete

- Status: Accepted
- Date: 2026-09-26

## Context

Much of the explorer's data is discovered, sampled or window-limited by
design: heuristic address tx history, first-page transfers scans, sampled
charts, window-limited approvals, RPC-dependent capability surfaces. PM
reviews repeatedly ranked "partial data presented as complete" as the top
product defect. The fix waves introduced `CoverageBadge`
(`src/components/ui/CoverageBadge.tsx`) with a fixed vocabulary —
`live | cached-immutable | discovered | sampled | partial | unavailable` —
plus pure derivations in `views/Address/coverage.ts` and
`views/Contract/coverage.ts`, and the `/about/coverage` legend page
(AGENTS.md → 2026-09-23 wave notes).

## Decision

- Every data surface declares a coverage level from the fixed vocabulary.
- Partial/sampled/discovered data is never worded or rendered as complete;
  gaps stay gaps (never zero-filled), and "at least N" phrasing is used for
  lower-bounded discoveries.
- `coverage: 'complete'` may only ever be derived from a **genesis-anchored
  finished deep scan** (`fromBlock === 0`, reason `'deep-scan'`; derived at
  read time, never stored). The tx heuristic can never emit it.
- One page-level CoverageBadge per page; long caveat paragraphs live inside
  the badge's ⓘ detail; mandatory one-line chips stay inline.
- An empty list is not proof of absence where coverage is unknown — render
  the "source unknown" banner instead.

## Consequences

- Caveat copy is part of the product contract — tests pin wording; changing
  it is a deliberate act, not copy-editing.
- New features must pick a level and wire the badge derivation before ship.
- Estimations (e.g. range ETA) render only with an honest slope and a "~"
  prefix — never a promise.
- The vocabulary is closed: extending it means updating the shared glyphs
  export and the `/about/coverage` legend in the same change.
