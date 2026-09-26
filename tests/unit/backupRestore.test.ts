// Contract tests for the backup orchestration service
// (services/backupRestore.ts): the honesty rules of export (an
// unreachable backend still exports the browser-local parts with the
// "server data skipped" attribution; a redacted RPC URL is never written
// into a backup; the admin gate skips labels with a note) and the
// per-item reporting of restore (a 403 collapses to adminDenied while
// the remaining writes proceed; localStorage writes actually land).
// Transport and the two write services are stubbed at their module
// boundaries; the localStorage-visible behavior is real.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAddress } from 'viem';
import { ApiError } from '@/util/apiError';
import type { RestorePlan } from '@/util/localBackup';

const { mockGet, mockSaveAddressLabel, mockAddCustomChain } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSaveAddressLabel: vi.fn(),
  mockAddCustomChain: vi.fn(),
}));

vi.mock('@/util/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/util/http')>();
  return {
    ...actual,
    get: mockGet,
    // The service only branches on ApiError identity/status; the real
    // helper's logic is exactly that.
    isBackendUnreachable: (e: unknown): boolean =>
      e instanceof ApiError && e.status === 0,
  };
});

vi.mock('@/services/labels', () => ({
  saveAddressLabel: mockSaveAddressLabel,
}));

vi.mock('@/services/customChains', () => ({
  addCustomChain: mockAddCustomChain,
}));

import { collectBackupParts, executeRestore } from '@/services/backupRestore';

beforeEach(() => {
  mockGet.mockReset();
  mockSaveAddressLabel.mockReset();
  mockAddCustomChain.mockReset();
  localStorage.clear();
});

describe('collectBackupParts — honest degradation', () => {
  it('exports the browser-local parts with the unreachable note when the backend is down', async () => {
    localStorage.setItem('be:watchlist', JSON.stringify(['0x1234567890abcdef1234567890abcdef12345678']));
    localStorage.setItem('be:theme', 'dark');
    localStorage.setItem('be:ipfsGateway', 'https://pin.mydomain.dev');
    localStorage.setItem('custom-abi:1:0x1234567890abcdef1234567890abcdef12345678', '[]');
    const noteKey = 'be:privateNote:137:0xabcdef0123456789012345678901234567890123';
    localStorage.setItem(noteKey, 'polygon hot wallet');
    mockGet.mockRejectedValue(new ApiError('Network error', 0));

    const parts = await collectBackupParts();

    expect(parts.labels).toEqual([]);
    expect(parts.customChains).toEqual([]);
    expect(parts.notes).toEqual(['server data skipped — backend unreachable']);
    // The browser-local parts survive verbatim — null only for keys
    // this browser never set. Private notes scan in like custom ABIs,
    // their address checksum-normalized from the stored key.
    expect(parts.browser).toEqual({
      watchlist: ['0x1234567890abcdef1234567890abcdef12345678'],
      theme: 'dark',
      ipfsGateway: 'https://pin.mydomain.dev',
      customAbis: [{ key: 'custom-abi:1:0x1234567890abcdef1234567890abcdef12345678', abi: '[]' }],
      privateNotes: [
        { chainId: 137, address: getAddress('0xabcdef0123456789012345678901234567890123'), note: 'polygon hot wallet' },
      ],
    });
  });

  it('skips corrupted private-note entries with an attribution line instead of exporting them broken', async () => {
    mockGet.mockResolvedValueOnce({ labels: [] });
    mockGet.mockResolvedValueOnce({ chains: [] });
    // A grammar-matching key holding an over-cap (hand-corrupted) value.
    localStorage.setItem('be:privateNote:1:0x1234567890abcdef1234567890abcdef12345678', 'x'.repeat(281));
    // A grammar-matching key with a WRONG EIP-55 checksum spelling (the
    // regex sees 40 hex chars; the two-tier check refuses it).
    localStorage.setItem('be:privateNote:1:0x1234567890AbCdEf1234567890abCdEf12345678', 'x');

    const parts = await collectBackupParts();

    expect(parts.browser.privateNotes).toEqual([]);
    expect(parts.notes).toEqual([
      '2 private note(s) skipped — the stored entry is corrupted (unreadable key or over-length value)',
    ]);
  });

  it('attributes a 403 label read to the admin gate', async () => {
    mockGet.mockRejectedValueOnce(new ApiError('Invalid admin token.', 403));
    mockGet.mockResolvedValueOnce({ chains: [] });

    const parts = await collectBackupParts();

    expect(parts.labels).toEqual([]);
    expect(parts.customChains).toEqual([]);
    expect(parts.notes).toEqual(['labels skipped — admin token required (save it under "Admin token", then retry the export)']);
  });

  it('never writes a redacted RPC URL into a backup', async () => {
    mockGet.mockResolvedValueOnce({
      labels: [{ chainId: 1, address: '0x1234567890abcdef1234567890abcdef12345678', label: 'L', note: null, source: 'user', updatedAt: '2026-09-24T10:30:00.000Z' }],
    });
    mockGet.mockResolvedValueOnce({
      chains: [
        { chainId: 31337, name: 'Anvil', symbol: 'ETH', decimals: 18, rpcUrl: 'http://127.0.0.1:8545', urlRedacted: false },
        { chainId: 9999, name: 'Secret', symbol: 'X', decimals: 18, rpcUrl: 'https://provider.example', urlRedacted: true },
      ],
    });

    const parts = await collectBackupParts();

    expect(parts.labels).toHaveLength(1);
    expect(parts.customChains).toEqual([
      { chainId: 31337, name: 'Anvil', symbol: 'ETH', decimals: 18, rpcUrl: 'http://127.0.0.1:8545' },
    ]);
    expect(parts.notes).toEqual([
      '1 custom chain(s) skipped — RPC URL redacted for this browser (open the explorer via localhost or a trusted origin to include them)',
    ]);
  });
});

describe('executeRestore — per-item reporting', () => {
  it('writes localStorage, continues past a label 403 (one admin line), and registers chains', async () => {
    mockSaveAddressLabel
      .mockResolvedValueOnce({ label: 'A', note: null, source: 'user', chainId: 1, address: '0xabc' })
      .mockRejectedValueOnce(new ApiError('Invalid admin token.', 403));
    mockAddCustomChain.mockResolvedValue({
      chainId: 31337,
      name: 'Anvil',
      symbol: 'ETH',
      decimals: 18,
      rpcUrl: 'http://127.0.0.1:8545',
    });

    const plan: RestorePlan = {
      storageWrites: [
        { key: 'be:theme', value: 'dark', overwrites: false },
        { key: 'custom-abi:1:0x1234567890abcdef1234567890abcdef12345678', value: '[]', overwrites: true },
      ],
      labelPuts: [
        { chainId: 1, address: '0x1234567890abcdef1234567890abcdef12345678', label: 'A', note: null },
        { chainId: 137, address: '0xabcdef0123456789012345678901234567890123', label: 'B', note: 'x' },
      ],
      chainPosts: [
        { chainId: 31337, input: { rpcUrl: 'http://127.0.0.1:8545', name: 'Anvil', symbol: 'ETH', decimals: 18 } },
      ],
    };

    const report = await executeRestore(plan);

    expect(localStorage.getItem('be:theme')).toBe('dark');
    expect(localStorage.getItem('custom-abi:1:0x1234567890abcdef1234567890abcdef12345678')).toBe('[]');
    expect(report.storage).toEqual({ written: 2, failures: [] });
    // The 403 collapses to the single admin line — no stacked failures.
    expect(report.labels).toEqual({
      attempted: 2,
      restored: 1,
      adminDenied: true,
      failures: [],
    });
    expect(report.chains).toEqual({ attempted: 1, registered: 1, adminDenied: false, failures: [] });
  });

  it('reports a failing chain probe individually without blocking the rest', async () => {
    mockAddCustomChain
      .mockRejectedValueOnce(new ApiError('The RPC endpoint could not be reached.', 502))
      .mockResolvedValueOnce({ chainId: 1, name: 'Ok', symbol: 'T', decimals: 18, rpcUrl: 'https://ok' });

    const report = await executeRestore({
      storageWrites: [],
      labelPuts: [],
      chainPosts: [
        { chainId: 111, input: { rpcUrl: 'https://dead', name: 'Dead' } },
        { chainId: 222, input: { rpcUrl: 'https://ok', name: 'Ok' } },
      ],
    });

    expect(report.chains.registered).toBe(1);
    expect(report.chains.failures).toEqual([
      { name: 'Dead', message: 'The RPC endpoint could not be reached.' },
    ]);
  });
});
