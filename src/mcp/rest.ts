// REST client for the explorer backend, used by the MCP server.
//
// The MCP server is a SEPARATE process from the backend on purpose: the
// backend owns the DuckDB single-writer lock, and a second in-process
// consumer would fight over data/blockchain.db (the documented failure
// mode of running `pnpm dev` and `pnpm dev:server` side by side).
// Everything persistent therefore travels over HTTP — exactly like the
// browser frontend does — and this module is the entire HTTP surface.
//
// The base URL comes from EXPLORER_API_URL (default http://127.0.0.1:8201),
// the same origin the service-discovery gate picks for the web UI. No
// Origin header is sent (plain Node fetch), which the rpc-configs /
// custom-chains redaction policy treats as a loopback-class reader, so
// this server receives FULL (unredacted) configured RPC urls.

/** Fetch failed before any HTTP status existed — backend not running. */
export class McpBackendUnreachableError extends Error {
  constructor(
    public readonly base: string,
    public readonly cause_: unknown,
  ) {
    super(
      `Explorer backend unreachable at ${base} — start it with \`npx my-block-explorer\` ` +
      `(or \`pnpm dev:server\` in the repo), or point EXPLORER_API_URL at a running instance. ` +
      `Detail: ${causeMessage(cause_)}`,
    );
    this.name = 'McpBackendUnreachableError';
  }
}

/** The backend answered with a non-2xx status. */
export class McpApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'McpApiError';
  }
}

function causeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

type FetchLike = (
  url: string,
  init: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** How long one REST call may take (source fetches fall back to Sourcify/Blockscan on cache misses). */
const REQUEST_TIMEOUT_MS = 30_000;

export type QueryValue = string | number | boolean | undefined;

/**
 * Thin GET-only client. Every endpoint the MCP tools consume is an open
 * read (admin-gated and rate-limit buckets are the browser API's concern;
 * see docs/MCP.md for the buckets that apply).
 */
export class ExplorerApi {
  readonly base: string;

  constructor(
    base: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {
    // Normalize away trailing slashes so path joining is a plain concat.
    this.base = base.replace(/\/+$/, '');
  }

  /** GET a JSON endpoint; throws McpBackendUnreachableError / McpApiError. */
  async get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(url.toString(), {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // AbortSignal.timeout surfaces as a TimeoutError DOMException; both
      // it and ECONNREFUSED mean "no backend answered" to a tool caller.
      throw new McpBackendUnreachableError(this.base, error);
    }
    const body = await response.text();
    if (!response.ok) {
      throw toApiError(response.status, body);
    }
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new McpApiError(response.status, undefined, `Backend returned non-JSON body: ${body.slice(0, 200)}`);
    }
  }

  /**
   * GET that degrades to null when the backend is unreachable (no HTTP
   * status at all). Used by surfaces that must keep working RPC-only —
   * real API errors still throw.
   */
  async tryGet<T>(path: string, query?: Record<string, QueryValue>): Promise<T | null> {
    try {
      return await this.get<T>(path, query);
    } catch (error) {
      if (error instanceof McpBackendUnreachableError) return null;
      throw error;
    }
  }
}

/** Map an error body onto the repo's `{error, message}` envelope convention. */
function toApiError(status: number, body: string): McpApiError {
  // The message is what MCP tool callers see (the SDK surfaces thrown
  // Errors as isError results verbatim), so bake in the status context.
  let code: string | undefined;
  let envelopeMessage = '';
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown; code?: unknown };
    if (typeof parsed.error === 'string') code = parsed.error;
    if (typeof parsed.code === 'string' && parsed.code !== '') code = parsed.code;
    if (typeof parsed.message === 'string' && parsed.message !== '') envelopeMessage = parsed.message;
    else if (typeof parsed.error === 'string') envelopeMessage = parsed.error;
  } catch {
    // Non-JSON body — fall through to the raw text.
  }
  if (envelopeMessage === '') envelopeMessage = body.slice(0, 200) || `HTTP ${status}`;
  return new McpApiError(
    status,
    code,
    `Backend answered HTTP ${status}${code !== undefined ? ` (${code})` : ''}: ${envelopeMessage}`,
  );
}
