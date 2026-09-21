// ContractVerifyService behavior: the Sourcify APIv2 submit + poll wire
// protocol, the outcome mapping (exact_match/match -> perfect/partial,
// unsupported-chain detection across sourcify's vocabularies, verbatim
// rejection messages), the typed SourcifyUnreachableError for network /
// 5xx / timeout, and the bundle caps enforced before any network. Global
// fetch is mocked — no network, no database.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  contractVerifyService,
  SourcifyUnreachableError,
} from '@/services/ContractVerifyService';

const CHAIN_ID = 11155111;
const ADDRESS = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
const JOB_ID = '550e8400-e29b-41d4-a716-446655440000';

const METADATA_JSON = JSON.stringify({
  compiler: { version: '0.8.20+commit.a1b79de6' },
  language: 'Solidity',
  sources: { 'contracts/Storage.sol': { keccak256: '0xabc', urls: [] } },
});

const bundle = (): Record<string, string> => ({
  'metadata.json': METADATA_JSON,
  'contracts/Storage.sol': 'pragma solidity ^0.8.20;\ncontract Storage {}\n',
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Sourcify's documented 4xx error envelope: {customCode, message, errorId}.
const sourcifyError = (customCode: string, message: string) => ({
  customCode,
  message,
  errorId: '1ac6b91a-0605-4459-93dc-18f210a70192',
});

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  delete process.env.SOURCIFY_SERVER_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ContractVerifyService - outcome mapping', () => {
  it('maps a completed job\'s exact_match to a perfect success', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { verificationId: JOB_ID }))
      .mockResolvedValueOnce(
        jsonResponse(200, { isJobCompleted: true, contract: { match: 'exact_match' } }),
      );

    const outcome = await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    expect(outcome).toEqual({ ok: true, status: 'perfect' });
  });

  it('maps a runtime-only match to a partial success', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { verificationId: JOB_ID }))
      .mockResolvedValueOnce(
        jsonResponse(200, { isJobCompleted: true, contract: { match: 'match' } }),
      );

    const outcome = await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    expect(outcome).toEqual({ ok: true, status: 'partial' });
  });

  it('maps an unsupported_chain customCode to supported:false with the upstream words', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        400,
        sourcifyError('unsupported_chain', 'The chain with chainId 9429413 is not supported'),
      ),
    );

    const outcome = await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    expect(outcome).toEqual({
      ok: false,
      kind: 'unsupported_chain',
      message: 'The chain with chainId 9429413 is not supported',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recognizes v1-era unknown-chain wording in a plain 4xx message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, sourcifyError('bad_params', 'unknown-chain: verification not available')),
    );

    const outcome = await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    expect(outcome).toEqual({
      ok: false,
      kind: 'unsupported_chain',
      message: 'unknown-chain: verification not available',
    });
  });

  it('maps any other submit-time validation error to a verbatim rejection', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        400,
        sourcifyError('compilation_failed', 'Could not find metadata for hash 0xabc'),
      ),
    );

    const outcome = await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    expect(outcome).toEqual({
      ok: false,
      kind: 'rejected',
      message: 'Could not find metadata for hash 0xabc',
    });
  });

  it('maps a completed job error (no_match) to a verbatim rejection', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { verificationId: JOB_ID }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          isJobCompleted: true,
          error: sourcifyError('no_match', 'The onchain and recompiled bytecodes don\'t match.'),
        }),
      );

    const outcome = await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    expect(outcome).toEqual({
      ok: false,
      kind: 'rejected',
      message: 'The onchain and recompiled bytecodes don\'t match.',
    });
  });

  it('keeps polling while the job is pending, then reports the outcome', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { verificationId: JOB_ID }))
      .mockResolvedValueOnce(jsonResponse(200, { isJobCompleted: false, verificationId: JOB_ID }))
      .mockResolvedValueOnce(
        jsonResponse(200, { isJobCompleted: true, contract: { match: 'exact_match' } }),
      );

    const outcome = await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    expect(outcome).toEqual({ ok: true, status: 'perfect' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('ContractVerifyService - wire protocol', () => {
  it('posts the parsed metadata object and metadata-free sources to the v2 endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { verificationId: JOB_ID }))
      .mockResolvedValueOnce(
        jsonResponse(200, { isJobCompleted: true, contract: { match: 'exact_match' } }),
      );

    await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    // The init is always passed by the service; the fetch signature keeps
    // it optional, so the tuple is asserted for property access.
    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(submitUrl).toBe(
      `https://sourcify.dev/server/v2/verify/metadata/${CHAIN_ID}/${ADDRESS}`,
    );
    expect(submitInit.method).toBe('POST');
    const sent = JSON.parse(String(submitInit.body)) as {
      metadata: { compiler: { version: string } };
      sources: Record<string, string>;
    };
    // metadata travels as the parsed object, not as a string.
    expect(sent.metadata.compiler.version).toBe('0.8.20+commit.a1b79de6');
    // metadata.json itself is not part of the sources map.
    expect(Object.keys(sent.sources)).toEqual(['contracts/Storage.sol']);
    expect(sent.sources['contracts/Storage.sol']).toContain('contract Storage');

    // The poll targets the ticketed job endpoint.
    expect(fetchMock.mock.calls[1][0]).toBe(`https://sourcify.dev/server/v2/verify/${JOB_ID}`);
  });

  it('honors the SOURCIFY_SERVER_URL override with trailing slashes stripped', async () => {
    process.env.SOURCIFY_SERVER_URL = 'https://sourcify.example/server/';
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { verificationId: JOB_ID }))
      .mockResolvedValueOnce(
        jsonResponse(200, { isJobCompleted: true, contract: { match: 'match' } }),
      );

    await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://sourcify.example/server/v2/verify/metadata/${CHAIN_ID}/${ADDRESS}`,
    );
    expect(fetchMock.mock.calls[1][0]).toBe(`https://sourcify.example/server/v2/verify/${JOB_ID}`);
  });
});

describe('ContractVerifyService - upstream failures', () => {
  it('throws the typed error on an upstream 5xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

    const attempt = contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    await expect(attempt).rejects.toBeInstanceOf(SourcifyUnreachableError);
    await expect(attempt).rejects.toThrow(/HTTP 500/);
  });

  it('throws the typed error with a deadline message when the request times out', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('signal timed out', 'TimeoutError'));

    const attempt = contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    await expect(attempt).rejects.toBeInstanceOf(SourcifyUnreachableError);
    await expect(attempt).rejects.toThrow(/did not finish within 30s/);
  });

  it('throws the typed error on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const attempt = contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    await expect(attempt).rejects.toBeInstanceOf(SourcifyUnreachableError);
    await expect(attempt).rejects.toThrow(/Could not reach the Sourcify server/);
  });

  it('throws the typed error when a 2xx answer carries no verificationId', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { ok: true }));

    const attempt = contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, bundle());

    await expect(attempt).rejects.toBeInstanceOf(SourcifyUnreachableError);
    await expect(attempt).rejects.toThrow(/without a verificationId/);
  });
});

describe('ContractVerifyService - bundle validation before the network', () => {
  it('rejects a bundle without metadata.json without any fetch', async () => {
    const outcome = await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, {
      'contracts/Storage.sol': 'contract Storage {}',
    });

    expect(outcome).toMatchObject({ ok: false, kind: 'rejected' });
    expect(outcome.ok === false && outcome.message).toContain('metadata.json is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unparseable metadata.json with the parse error', async () => {
    const outcome = await contractVerifyService.submitVerification(CHAIN_ID, ADDRESS, {
      'metadata.json': '{not json',
    });

    expect(outcome.ok === false && outcome.message).toContain('not valid JSON');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
