// Webhook delivery for the server-side watchlist — the pure half of
// services/WatchService.ts's per-event delivery. Everything here is
// side-effect-light and dependency-clean (viem + the shared chain
// config only), so both the backend service and the frontend hint UI
// (views/Home/Watchlist.tsx's "Discord webhook detected" label) can
// import the predicates/builders without pulling in the database or a
// logger.
//
// Honesty rules encoded:
// - The payload carries what the watcher actually KNOWS. The watch tail
//   holds raw logs, not contract ABIs: eventName is filled from the
//   locally resolvable signature table (canonical ERC events + any ABI
//   events registered through utils/events.ts) and is null — never
//   guessed — when topic0 is unknown. Undecodable events still deliver,
//   with the raw topics/data envelope as their args.
// - Bigints travel as decimal strings (the repo-wide payload
//   convention), so the JSON body is always JSON.stringify-safe.
// - The sender never throws: every failure mode (network error, 5s
//   timeout, non-2xx status) collapses into { ok: false, reason } and
//   the caller records it on the subscription row.
import { decodeEventLog, getEventSelector, parseAbiItem, type AbiEvent, type Log } from 'viem';
import { getEventNameFromSignature } from './events';

// One delivery attempt gets 5 seconds; sendWebhookWithRetry then gets
// exactly one more (the assignment's "timeout 5s, ONE retry").
export const WATCH_WEBHOOK_TIMEOUT_MS = 5_000;

// webhookStatus column vocabulary: 'ok' after a delivered POST,
// 'failed: <short reason>' after the retry also failed, null before any
// delivery (and after the webhook URL is re-put — status belongs to the
// URL that produced it).
export type WebhookDeliveryStatus = 'ok' | `failed: ${string}` | null;

// The exact JSON body POSTed for each new log event (non-Discord
// endpoints; Discord gets buildDiscordMessage's shape instead).
export type WebhookEventPayload = {
  /** Stable identity + dedupe basis: chain:txHash:logIndex (SSE's watchEventKey). */
  id: string;
  chainId: number;
  /** The watched address (lowercase — the log's emitter). */
  address: string;
  /** Locally resolvable event name; null when topic0 is unknown. */
  eventName: string | null;
  /** Decoded args for known events, else the raw {topics, data} envelope. BigInt → decimal string. */
  args: Record<string, unknown>;
  /** Decimal string (the feed convention — never a raw bigint). */
  blockNumber: string;
  transactionHash: string | null;
  logIndex: number | null;
  /** Server clock when the sweep detected the event (ISO string). */
  detectedAt: string;
};

// Stable per-event id, mirroring services/watch.ts's watchEventKey
// (chain:txHash:logIndex) so webhook delivery dedupes on the SAME basis
// the SSE feed's consumers do; pending-log races degrade to the same
// 'tx?'/-1 sentinels rather than fabricating values.
export function webhookEventId(
  chainId: number,
  txHash: string | null,
  logIndex: number | null,
): string {
  return `${chainId}:${txHash ?? 'tx?'}:${logIndex ?? -1}`;
}

// Canonical ERC events the watcher can decode without an ABI: topic0 →
// {name, event}. Selectors are computed once at module load.
const WELL_KNOWN_EVENTS: Record<string, { name: string; event: AbiEvent }> = {
  [getEventSelector('Transfer(address,address,uint256)')]: {
    name: 'Transfer',
    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
  },
  [getEventSelector('Approval(address,address,uint256)')]: {
    name: 'Approval',
    event: parseAbiItem('event Approval(address indexed owner, address indexed spender, uint256 value)'),
  },
  [getEventSelector('OwnershipTransferred(address,address)')]: {
    name: 'OwnershipTransferred',
    event: parseAbiItem(
      'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
    ),
  },
};

/**
 * Is this a Discord webhook endpoint? Discord's incoming-webhook
 * surface lives under discord.com/api/webhooks/… (https only); such URLs
 * get the {content, embeds} body instead of the generic payload.
 */
export function isDiscordWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'discord.com' && host !== 'www.discord.com') return false;
    return parsed.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

/**
 * Recursively make a decoded-args value JSON-safe: bigints become
 * decimal strings (the payload convention), arrays and plain objects
 * walk their children. Anything else passes through untouched.
 */
export function toJsonSafeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafeValue);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = toJsonSafeValue(child);
    }
    return out;
  }
  return value;
}

/**
 * Pure log → generic webhook payload. The id is the dedupe basis; the
 * args are decoded for well-known events, the raw envelope otherwise;
 * bigints are stringified so the body stringifies cleanly.
 */
export function buildWebhookPayload(
  chainId: number,
  watchedAddress: string,
  log: Log,
  at: Date = new Date(),
): WebhookEventPayload {
  const topic0 = log.topics[0] ?? null;
  let eventName: string | null = null;
  let args: Record<string, unknown>;

  const wellKnown = topic0 !== null ? WELL_KNOWN_EVENTS[topic0] : undefined;
  if (wellKnown !== undefined) {
    eventName = wellKnown.name;
    try {
      const decoded = decodeEventLog({
        abi: [wellKnown.event],
        data: log.data,
        topics: [...log.topics],
      });
      // decodeEventLog on a dynamic AbiEvent[] loses the literal-ABI
      // generic — narrow defensively instead of trusting the type.
      args =
        typeof decoded.args === 'object' && decoded.args !== null
          ? (toJsonSafeValue(decoded.args) as Record<string, unknown>)
          : {};
    } catch {
      // Malformed topics/data for this shape: deliver the raw envelope
      // rather than dropping the event.
      args = { topics: [...log.topics], data: log.data };
    }
  } else if (topic0 !== null) {
    // Events registered from a contract ABI elsewhere in the process
    // (utils/events.ts registry): named, but undecodable here — deliver
    // the name plus the raw envelope, never fabricated args.
    const registered = getEventNameFromSignature(topic0);
    eventName = registered !== 'Unknown' ? registered : null;
    args = { topics: [...log.topics], data: log.data };
  } else {
    args = { topics: [...log.topics], data: log.data };
  }

  return {
    id: webhookEventId(chainId, log.transactionHash ?? null, log.logIndex ?? null),
    chainId,
    address: watchedAddress.toLowerCase(),
    eventName,
    args,
    blockNumber: (log.blockNumber ?? 0n).toString(),
    transactionHash: log.transactionHash ?? null,
    logIndex: log.logIndex ?? null,
    detectedAt: at.toISOString(),
  };
}

// Discord embed description budget: enough for a decoded ERC-20
// Transfer, bounded so a huge data blob cannot blow the embed limit.
const DISCORD_DESCRIPTION_MAX = 900;

/**
 * One-line "k=v, k=v" summary of the payload's args for the Discord
 * embed description, truncated honestly at the budget.
 */
export function summarizeArgsForEmbed(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([key, value]) => {
    const text =
      typeof value === 'string'
        ? value
        : typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value);
    return `${key}=${text}`;
  });
  const joined = parts.join(', ');
  if (joined.length <= DISCORD_DESCRIPTION_MAX) return joined;
  return `${joined.slice(0, DISCORD_DESCRIPTION_MAX - 1)}…`;
}

/**
 * Pure payload → Discord incoming-webhook body: a one-line content
 * summary plus one embed titled with the event name and linked to the
 * external explorer's tx page (url omitted when the tx hash is missing
 * — the pending-log race — rather than linked to nothing).
 */
export function buildDiscordMessage(
  payload: WebhookEventPayload,
  txUrl: string | null,
): { content: string; embeds: { title: string; description: string; url?: string }[] } {
  const embed: { title: string; description: string; url?: string } = {
    title: payload.eventName ?? 'Event (unknown signature)',
    description: summarizeArgsForEmbed(payload.args),
  };
  if (txUrl !== null && payload.transactionHash !== null) {
    embed.url = txUrl;
  }
  return {
    content:
      `Watched address ${payload.address} emitted ${payload.eventName ?? 'an event'}`
      + ` in block ${payload.blockNumber} (chain ${payload.chainId})`,
    embeds: [embed],
  };
}

/** Collapse a failure reason to a short, single-line, bounded string. */
export function shortWebhookReason(reason: string): string {
  const collapsed = reason.replace(/\s+/g, ' ').trim();
  return collapsed.length <= 80 ? collapsed : `${collapsed.slice(0, 79)}…`;
}

// Outcome of ONE delivery attempt (the sender's unit); the retry loop
// lives above it. Never a throw.
export type WebhookSendResult = { ok: true; status: number } | { ok: false; reason: string };

// The injectable seam: tests pass a fake; the service passes the fetch
// implementation by default.
export type WebhookSender = (
  url: string,
  body: unknown,
  timeoutMs?: number,
) => Promise<WebhookSendResult>;

/**
 * Fetch-based sender: POSTs the body as JSON with a hard timeout, maps
 * every failure (non-2xx, network error, timeout) to { ok: false,
 * reason }. NEVER throws — the tick loop's only obligation is recording.
 */
export const fetchWebhookSender: WebhookSender = async (url, body, timeoutMs) => {
  const budget = timeoutMs ?? WATCH_WEBHOOK_TIMEOUT_MS;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(budget),
    });
    if (!res.ok) {
      return { ok: false, reason: shortWebhookReason(`HTTP ${res.status}`) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return {
      ok: false,
      reason: shortWebhookReason(err instanceof Error ? err.message : 'network error'),
    };
  }
};

/**
 * Delivery with the honest retry budget: ONE retry on failure, then the
 * final result (the caller records it — failures are never escalated to
 * exceptions).
 */
export async function sendWebhookWithRetry(
  url: string,
  body: unknown,
  sender: WebhookSender,
  timeoutMs?: number,
): Promise<WebhookSendResult> {
  const first = await sender(url, body, timeoutMs);
  if (first.ok) return first;
  return sender(url, body, timeoutMs);
}
