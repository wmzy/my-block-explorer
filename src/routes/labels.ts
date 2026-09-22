// Address-label routes: user-authored annotations pinned to one address on
// one chain (GET /api/chains/:chainId/labels/:address). Reads are open — a
// label is the operator's own note about a public address. Writes (PUT
// upsert, DELETE) are gated by requireAdminTokenIfConfigured, so a
// zero-config local session edits freely while a token-configured server
// stays protected.
//
// Honesty rules: a missing label is 404 'label_not_found' (an explicit
// "absent" answer, never a 200 with nulls); PUT replaces the row wholesale
// (an omitted note clears it — full-replace semantics, not a patch); and
// body validation fails loudly with 400 'invalid_label' instead of silently
// coercing garbage into the user's notes.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq, sql } from 'drizzle-orm';
import { db, addressLabels } from '../database/init';
import { createLogger } from '../server/logger';
import { getValidatedAddress, getValidatedChainId } from '../server/validation';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';

const logger = createLogger('labels-routes');

const app = new Hono();

const LABEL_MAX_LENGTH = 64;
const NOTE_MAX_LENGTH = 500;

// Same validation channel as the events routes (getValidatedAddress: shape
// tier, then EIP-55 checksum for mixed-case input), with the HTTPException
// converted into this file's JSON error shape instead of escaping as Hono's
// plain-text exception response. Storage keys stay lowercase (C-3).
const parseChainAndAddress = (
  chainIdStr: string,
  addressStr: string,
): { chainId: number; address: `0x${string}` } | { error: string; message: string } => {
  try {
    const chainId = getValidatedChainId(chainIdStr);
    const address = getValidatedAddress(addressStr).toLowerCase() as `0x${string}`;
    return { chainId, address };
  }
  catch (error) {
    return {
      error: 'invalid_request',
      message:
        error instanceof HTTPException
          ? error.message
          : 'Chain ID and address must be valid',
    };
  }
};

// PUT body validation: { label: 1-64 chars after trim, note?: <=500 chars }.
// An absent/null/whitespace-only note normalizes to null (cleared); a note
// over the cap is a 400, not a silent truncation. Unknown extra keys are
// ignored (forward compatibility).
const parseLabelBody = (
  body: unknown,
): { label: string; note: string | null } | { error: string; message: string } => {
  if (typeof body !== 'object' || body === null) {
    return { error: 'invalid_label', message: 'Request body must be a JSON object' };
  }
  const { label, note } = body as Record<string, unknown>;

  if (typeof label !== 'string') {
    return { error: 'invalid_label', message: 'label is required and must be a string' };
  }
  const trimmed = label.trim();
  if (trimmed.length < 1 || trimmed.length > LABEL_MAX_LENGTH) {
    return {
      error: 'invalid_label',
      message: `label must be 1-${LABEL_MAX_LENGTH} characters after trimming`,
    };
  }

  if (note === undefined || note === null) {
    return { label: trimmed, note: null };
  }
  if (typeof note !== 'string') {
    return { error: 'invalid_label', message: 'note must be a string when present' };
  }
  const trimmedNote = note.trim();
  if (trimmedNote.length > NOTE_MAX_LENGTH) {
    return {
      error: 'invalid_label',
      message: `note must be at most ${NOTE_MAX_LENGTH} characters`,
    };
  }
  return { label: trimmed, note: trimmedNote === '' ? null : trimmedNote };
};

// The label row for one (chain, address), or null — GET turns the null into
// an explicit 404 so "no label set" is never confused with an error.
const findLabelRow = async (chainId: number, address: `0x${string}`) => {
  const rows = await db
    .select({ label: addressLabels.label, note: addressLabels.note, source: addressLabels.source })
    .from(addressLabels)
    .where(and(eq(addressLabels.chainId, chainId), eq(addressLabels.address, address)));
  return rows[0] ?? null;
};

// GET /chains/:chainId/labels/:address — open read.
app.get('/chains/:chainId/labels/:address', async c => {
  const parsed = parseChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in parsed) return c.json(parsed, 400);

  try {
    const row = await findLabelRow(parsed.chainId, parsed.address);
    if (row === null) {
      return c.json(
        { error: 'label_not_found', message: 'No label set for this address' },
        404,
      );
    }
    c.header('Cache-Control', 'no-store');
    // source tells the client whether the row is a bundled seed
    // ('builtin') or operator-authored ('user') — the UI renders the
    // built-in marker from it. The column is nullable in storage (DuckDB
    // ADD COLUMN cannot carry constraints); the API contract is pinned
    // here: anything but 'builtin' reads as 'user'.
    const source = row.source === 'builtin' ? 'builtin' : 'user';
    return c.json({ label: row.label, note: row.note, source });
  }
  catch (error) {
    logger.error({ err: error }, 'Label lookup failed');
    return c.json({ error: 'internal_error', message: 'Label lookup failed' }, 500);
  }
});

// PUT /chains/:chainId/labels/:address — upsert (full replace). The row's
// updatedAt rides the conflict path; createdAt keeps its original value on
// update and defaults to now() on first insert.
app.put('/chains/:chainId/labels/:address', requireAdminTokenIfConfigured, async c => {
  const parsed = parseChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in parsed) return c.json(parsed, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  }
  catch {
    return c.json(
      { error: 'invalid_label', message: 'Request body must be valid JSON' },
      400,
    );
  }
  const parsedBody = parseLabelBody(body);
  if ('error' in parsedBody) return c.json(parsedBody, 400);

  const { chainId, address } = parsed;
  const { label, note } = parsedBody;

  try {
    // source is forced to 'user' on every write: an operator PUT over a
    // bundled seed converts the row into their own — user intent wins
    // over the dataset. Both the fresh-insert values and the
    // conflict-update set carry it (the update path is the conversion).
    await db
      .insert(addressLabels)
      .values({ chainId, address, label, note, source: 'user' })
      .onConflictDoUpdate({
        target: [addressLabels.chainId, addressLabels.address],
        set: { label, note, source: 'user', updatedAt: sql`now()` },
      });
    c.header('Cache-Control', 'no-store');
    return c.json({ label, note, source: 'user' });
  }
  catch (error) {
    logger.error({ err: error }, 'Label upsert failed');
    return c.json({ error: 'internal_error', message: 'Failed to save label' }, 500);
  }
});

// DELETE /chains/:chainId/labels/:address — remove the label. Deleting an
// absent label is 404 (idempotence would hide typos in the client's key).
app.delete('/chains/:chainId/labels/:address', requireAdminTokenIfConfigured, async c => {
  const parsed = parseChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in parsed) return c.json(parsed, 400);

  try {
    const existing = await findLabelRow(parsed.chainId, parsed.address);
    if (existing === null) {
      return c.json(
        { error: 'label_not_found', message: 'No label set for this address' },
        404,
      );
    }
    await db
      .delete(addressLabels)
      .where(
        and(eq(addressLabels.chainId, parsed.chainId), eq(addressLabels.address, parsed.address)),
      );
    return c.body(null, 204);
  }
  catch (error) {
    logger.error({ err: error }, 'Label delete failed');
    return c.json({ error: 'internal_error', message: 'Failed to delete label' }, 500);
  }
});

export default app;
