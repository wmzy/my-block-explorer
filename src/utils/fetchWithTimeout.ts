// Shared fetch-probe wrapper: the AbortController + setTimeout budget
// pair every endpoint probe uses, so a dead endpoint cannot hold the
// request (and its rate-limit token) hostage. Backend + browser shared
// (routes/chains.ts probes RPC candidates server-side, the
// auto-discovery hook probes backend ports client-side), hence this
// import-free home in utils.
//
// The budget covers the request through response headers; the (tiny,
// single-object JSON) body read stays in the caller's own try block, and
// callers keep their own failure wording — an abort surfaces here as the
// platform's ordinary AbortError, mapped by whoever catches it.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
