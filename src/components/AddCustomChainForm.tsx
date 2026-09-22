// Shared "Add chain" form for the two custom-chain entry points: the
// top-navigation chain selector and the unsupported-chain recovery card.
// Posts the RPC URL to the backend (which probes the endpoint's
// eth_chainId and persists the registration), surfaces honest inline
// feedback for every failure mode — unreachable RPC, garbage probe
// answer, id already known to viem, admin gate — and hands the
// registered chain to onAdded; the entry points own what happens next
// (select the chain vs navigate into it).
import { useState } from 'react';
import { css } from '@linaria/core';
import { Input, Button } from 'haze-ui';
import { addCustomChain } from '@/services/customChains';
import { ApiError } from '@/util/apiError';
import type { CustomChain } from '@/config/customChains';

const form = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
`;

const urlInput = css`
  input {
    font-family: var(--haze-font-mono);
  }
`;

const optionalsRow = css`
  display: grid;
  grid-template-columns: 1fr 96px 96px;
  gap: var(--haze-space-2);

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const actionsRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

const expectedHint = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const feedback = css`
  font-size: var(--haze-text-xs);
  padding: var(--haze-space-2) var(--haze-space-3);
  border-radius: var(--haze-radius-md);
  border: 1px solid var(--haze-color-danger);
  background: color-mix(in srgb, var(--haze-color-danger) 8%, transparent);
  color: var(--haze-color-danger);
  overflow-wrap: anywhere;
`;

export function AddCustomChainForm({
  onAdded,
  expectedChainId,
}: {
  /** Called once with the registered chain (its id is the probe's answer). */
  onAdded: (chain: CustomChain) => void;
  /** When the entry point already names a chain id (a /chain/:id dead end), hint it. */
  expectedChainId?: number;
}) {
  const [rpcUrl, setRpcUrl] = useState('');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmedUrl = rpcUrl.trim();
    if (trimmedUrl === '') {
      setError('Enter the chain’s RPC URL (http or https).');
      return;
    }

    const decimalsTrimmed = decimals.trim();
    const decimalsValue
      = decimalsTrimmed === '' ? undefined : Number(decimalsTrimmed);
    if (decimalsValue !== undefined && !Number.isInteger(decimalsValue)) {
      setError('Decimals must be a whole number (typically 18).');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const chain = await addCustomChain({
        rpcUrl: trimmedUrl,
        name: name.trim() === '' ? undefined : name.trim(),
        symbol: symbol.trim() === '' ? undefined : symbol.trim(),
        decimals: decimalsValue,
      });
      onAdded(chain);
    }
    catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError(
          'This server requires an admin token for chain registration — set it in the ⚙ RPC panel, then retry.',
        );
      }
      else if (e instanceof ApiError) {
        setError(e.message);
      }
      else {
        setError('Adding the chain failed.');
      }
    }
    finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className={form}
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input
        className={urlInput}
        placeholder="RPC URL (http://127.0.0.1:8545)"
        value={rpcUrl}
        onChange={e => setRpcUrl(e.target.value)}
        aria-label="RPC URL"
        disabled={submitting}
      />
      <div className={optionalsRow}>
        <Input
          placeholder="Name (optional)"
          value={name}
          onChange={e => setName(e.target.value)}
          aria-label="Chain name"
          disabled={submitting}
        />
        <Input
          placeholder="Symbol"
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          aria-label="Native symbol"
          disabled={submitting}
        />
        <Input
          placeholder="Decimals"
          value={decimals}
          onChange={e => setDecimals(e.target.value)}
          aria-label="Native decimals"
          inputMode="numeric"
          disabled={submitting}
        />
      </div>
      <div className={actionsRow}>
        <Button
          variant="solid"
          size="md"
          onClick={e => {
            e.preventDefault();
            void submit();
          }}
          disabled={submitting}
        >
          {submitting ? 'Probing RPC…' : 'Add chain'}
        </Button>
        {expectedChainId !== undefined && (
          <span className={expectedHint}>
            {'This page targets chain '}
            {expectedChainId}
            {' — the network the RPC reports is what gets registered.'}
          </span>
        )}
      </div>
      {error !== null && (
        <div className={feedback} role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
