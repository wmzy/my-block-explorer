// Shared JSON GET leaf: the fetch → non-2xx reject → body-parse trio
// every simple JSON endpoint client repeats (solc version list,
// DefiLlama prices/charts, NFT metadata gateways). Importable by both
// sides (backend services, browser services) — same home rule as
// fetchWithTimeout one file over, which now also supplies the transport
// budget. Its AbortController + setTimeout pair is deliberately NOT
// AbortSignal.timeout (older jsdom lacks it; the builds that have it
// run it on a native timer fake timers cannot drive) — see that file.
// The budget covers the request through response headers per
// fetchWithTimeout's contract; the tiny-body .json() read that follows
// is uncovered by design, same as every fetchWithTimeout caller.
import { fetchWithTimeout } from './fetchWithTimeout';

export async function fetchJson(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchWithTimeout(url, init ?? {}, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
