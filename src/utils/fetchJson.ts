// Shared JSON GET leaf: the fetch → non-2xx reject → body-parse trio
// every simple JSON endpoint client repeats (solc version list,
// DefiLlama prices/charts, NFT metadata gateways). Import-free so both
// sides (backend services, browser services) can take it — same home
// rule as fetchWithTimeout one file over.
//
// The budget is the AbortController + setTimeout pair, deliberately NOT
// AbortSignal.timeout: older jsdom test builds lack AbortSignal.timeout
// entirely, and the builds that have it run it on a native timer
// vitest fake timers cannot drive — the controller pair is the only
// budget that stays real in every environment, keeps the abort the
// platform's ordinary AbortError (mapped by whoever catches it), and
// absorbs nftMetadata's historical per-site timeout exemption (which
// feature-detected AbortSignal.timeout for older jsdom) into one
// universal mechanism.
export async function fetchJson(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
