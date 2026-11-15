/**
 * Shared rule + user-facing message for the startup reconciliation of
 * rows stranded in an active status by a dead process — the single home
 * for both so the threshold and the resume hint cannot drift apart
 * between EventIndexingService.reconcileInterruptedRanges and
 * AddressScanService.reconcileInterruptedAddressScans.
 *
 * Rule: the guard-and-flip update (CAS semantics — only rows still in
 * the active status flip) treats a row as stranded only when its last
 * checkpoint write is older than INTERRUPTED_ROW_STALE_MS; a live loop
 * checkpoints after every segment/batch, so a fresh updated_at means
 * "probably still walking" and survives the documented dual-process dev
 * topology (vite bridge + standalone server share the DB). A NULL
 * updated_at (legacy rows, nullable column) cannot be proven fresh and
 * counts as stale — only EventIndexingService needs the explicit
 * isNull(updatedAt) clause, because addressScanJobs.updatedAt is
 * NOT NULL.
 */
export const INTERRUPTED_ROW_STALE_MS = 2 * 60 * 1000;

// Byte-stable: tests and docs pin this exact wording.
export const INTERRUPTED_BY_RESTART_MESSAGE = 'Interrupted by server restart — resume to continue';
