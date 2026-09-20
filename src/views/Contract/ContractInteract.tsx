import { useState, useEffect, useMemo } from 'react';
import { css } from '@linaria/core';
import {
  parseContractFunctionsUnified,
  filterFunctions,
  functionSignature,
  readContract,
  simulateContract,
  type EnhancedContractFunction,
  type FilterState,
  type ReadWriteFilter,
} from '@/utils/contractInteraction';
import { FunctionCallForm } from './FunctionCallForm';
import { cardStyles } from './styles';
import { argsKey } from './types';
import type { ContractSource } from './types';
import { describeCallError } from './paramParsing';
import { fetchContractAbi } from '@/services/contracts';

const functionListStyles = css`
  .function-item {
    background: #f8f9fa;
    border: 1px solid #e1e5e9;
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 8px;

    .function-signature {
      font-family:
        'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 4px;
    }

    .function-type {
      display: inline-block;
      background: #007bff;
      color: white;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
    }

    &.view .function-type {
      background: #28a745;
    }

    &.payable .function-type {
      background: #ffc107;
      color: #000;
    }
  }
`;

const filterControlsStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 16px;
  background: #f8f9fa;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  margin-bottom: 20px;
`;

const filterGroupStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const filterLabelStyles = css`
  font-size: 14px;
  font-weight: 500;
  color: #666;
`;

const filterSelectStyles = css`
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  background: white;
`;

const filterInputStyles = css`
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  width: 150px;
`;

const resetButtonStyles = css`
  padding: 6px 12px;
  background: #6c757d;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;

  &:hover {
    background: #5a6268;
  }
`;

// Wraps the block override row so the inline error can claim its own line.
const blockGroupStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const blockErrorStyles = css`
  flex-basis: 100%;
  font-size: 12px;
  color: #c62828;
`;

// Diamond facet-merge honesty notes: amber palette matches the diamond
// banner on the contract page — omissions are named, never silent.
const facetNoteStyles = css`
  margin-bottom: 16px;
  padding: 10px 14px;
  background: #fff8e6;
  border: 1px solid #f0a500;
  border-radius: 6px;
  font-size: 13px;
  color: #8a6d3b;

  div + div {
    margin-top: 6px;
  }
`;

// The block override feeds viem's bigint `blockNumber` parameter directly —
// this call path supports no named tags ('latest', 'safe', ...) — so only
// plain decimal digits are acceptable. Empty input means 'latest'.
const BLOCK_NUMBER_PATTERN = /^\d+$/;
const BLOCK_NUMBER_ERROR = 'Enter a block number';

// ---- Diamond facet ABI merge ----
// The contract source payload only ships facet[0]'s ABI (implementationContract);
// every other EIP-2535 facet is still callable through the proxy address, so
// Interact merges the facets' ABIs into one callable surface. Both the
// function list and the per-call ABI routing consume the merged result.

type AbiEntry = { type?: string; name?: string; inputs?: Array<{ type?: string }> };

export type FacetAbi = { address: string; abi: string | null };

export type FacetAbiMerge = {
  // One JSON ABI string with facet[0] first and every other facet's unique
  // entries appended; undefined only when no ABI at all contributed.
  merged: string | undefined;
  // Facets whose ABI could not be read at all (fetch failure or an
  // unparseable answer) — their functions cannot be listed and the
  // omission must stay visible.
  unavailable: string[];
  // Function signatures a later facet re-defined after an earlier facet
  // (facet order, facet[0] first): the first definition wins and the
  // duplicate is dropped — EIP-2535 forbids selector collisions, so this is
  // mostly shared helper entries across facets.
  skippedSignatures: string[];
};

// Canonical dedup key for one ABI entry. Functions/events/errors key on
// name + input types (same signature = same selector); the singleton entry
// types (constructor/receive/fallback) key on their type alone.
const abiEntryKey = (entry: AbiEntry): string => {
  const types = (entry.inputs ?? []).map(input => input.type ?? '').join(',');
  return `${entry.type ?? ''}:${entry.name ?? ''}(${types})`;
};

// User-facing signature for the skipped annotation: name(input-types).
const signatureDisplay = (entry: AbiEntry): string =>
  `${entry.name ?? ''}(${(entry.inputs ?? []).map(input => input.type ?? '').join(',')})`;

const parseAbiEntries = (abi: string | null): AbiEntry[] | null => {
  if (!abi || abi.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(abi);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (entry): entry is AbiEntry =>
        typeof entry === 'object' && entry !== null && typeof (entry as AbiEntry).type === 'string',
    );
  } catch {
    return null;
  }
};

export const mergeFacetAbis = (
  base: string | undefined,
  extras: readonly FacetAbi[],
): FacetAbiMerge => {
  const mergedEntries: AbiEntry[] = [];
  const seen = new Set<string>();
  const skippedSignatures: string[] = [];
  const unavailable: string[] = [];

  // Collects every entry of a facet ABI; returns false only when the ABI
  // itself could not be read at all (fetch failure / unparseable) — a
  // verified-but-empty '[]' still counts as present.
  const collect = (abi: string | null): boolean => {
    const entries = parseAbiEntries(abi);
    if (entries === null) return false;
    for (const entry of entries) {
      const key = abiEntryKey(entry);
      if (seen.has(key)) {
        // Only functions are selector-addressable surface worth flagging;
        // duplicated events/constructors across facets are expected noise.
        if (entry.type === 'function') skippedSignatures.push(signatureDisplay(entry));
        continue;
      }
      seen.add(key);
      mergedEntries.push(entry);
    }
    return true;
  };

  // Facet[0] keeps the exact semantics of the old single-impl path: a
  // verified-but-empty '[]' ABI still yields '[]' so the availability gate
  // behaves identically to a non-diamond proxy.
  const basePresent = parseAbiEntries(base ?? null) !== null;
  if (basePresent) collect(base ?? null);
  for (const extra of extras) {
    if (!collect(extra.abi)) unavailable.push(extra.address);
  }

  return {
    merged: basePresent || mergedEntries.length > 0 ? JSON.stringify(mergedEntries) : undefined,
    unavailable,
    skippedSignatures,
  };
};

// Interact tab: parses the (possibly proxy + implementation) ABI into the
// unified function list, exposes read/write/name filters and a global block
// override, and routes each submit to a read or a write simulation.
export function ContractInteract({
  chainId,
  contractAddress,
  contractSource,
  contractTarget,
  abiOverride,
  mode = 'all',
}: {
  chainId: number;
  contractAddress: string;
  contractSource: ContractSource | null;
  contractTarget?: 'proxy' | 'impl';
  abiOverride?: string;
  mode?: 'all' | 'read' | 'write';
}) {
  const [allFunctions, setAllFunctions] = useState<EnhancedContractFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [globalBlockNumber, setGlobalBlockNumber] = useState('');
  const [blockError, setBlockError] = useState('');
  const [filters, setFilters] = useState<FilterState>({
    readWrite: 'all',
    source: 'all',
    name: '',
  });
  const [debouncedNameFilter, setDebouncedNameFilter] = useState('');

  // EIP-2535 diamonds: facet[0]'s ABI ships on implementationContract, the
  // other facets' ABIs are fetched lazily (one /abi call per facet, backend
  // + 24h client cached) and merged into the callable surface below.
  const diamondFacets = (contractSource?.implementationAddresses ?? []).filter(
    (facet): facet is string => !!facet,
  );
  const isDiamondProxy = !!contractSource?.isProxy && diamondFacets.length > 1;
  const [facetAbis, setFacetAbis] = useState<FacetAbi[]>([]);

  // Stable string key for the fetch effect's dependency (the facet array
  // identity changes every render).
  const extraFacetKey = isDiamondProxy ? diamondFacets.slice(1).join(',') : '';

  // Facet[0]'s ABI as shipped on the contract source (undefined when absent).
  const implABIString =
    contractSource?.isProxy && contractSource.implementationContract?.abi
      ? contractSource.implementationContract.abi
      : undefined;

  // Merged callable surface for diamonds (facet[0] + every fetched facet
  // ABI, deduped); for everything else this degrades to the plain
  // implementation ABI with empty annotations. Memoized: parsing every
  // facet ABI on each render would be pure waste.
  const facetMerge = useMemo(
    () => mergeFacetAbis(implABIString, facetAbis),
    [implABIString, facetAbis],
  );

  useEffect(() => {
    if (!isDiamondProxy) {
      // Drop any stale facet ABIs from a previous (diamond) contract —
      // bailing out on identity when already empty avoids a wasted render.
      setFacetAbis(prev => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    Promise.all(
      extraFacetKey
        .split(',')
        .filter(address => address !== '')
        .map(async address => ({
          address,
          abi: await fetchContractAbi(chainId, address)
            .then(response => (typeof response?.abi === 'string' ? response.abi : null))
            .catch(() => null),
        })),
    ).then(abis => {
      if (!cancelled) setFacetAbis(abis);
    });
    return () => {
      cancelled = true;
    };
  }, [chainId, isDiamondProxy, extraFacetKey]);

  useEffect(() => {
    if (contractSource?.abi || abiOverride) {
      loadContractFunctions();
    } else {
      // Nothing to parse without an ABI: stop loading so the
      // 'Contract ABI not available' fallback below is reachable instead
      // of an endless spinner.
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the contract data (or its merged facet ABIs) changes
  }, [chainId, contractAddress, contractSource, abiOverride, facetMerge]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedNameFilter(filters.name);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.name]);

  // ABI that a read/simulate call is routed against. For a real proxy pair
  // the target selector decides: 'proxy' targets the proxy's own ABI (its
  // admin functions), anything else targets the implementation ABI (the
  // pre-existing default). A diamond's implementation view routes through
  // the merged facet ABIs instead — every facet function stays callable on
  // the proxy address. Without a proxy pair the base ABI wins — the
  // override standing in for a missing server-supplied ABI.
  const resolveTargetABI = (): string | undefined => {
    const baseABI = abiOverride ?? contractSource?.abi;

    if (implABIString) {
      if (contractTarget === 'proxy') return baseABI;
      return isDiamondProxy ? facetMerge.merged : implABIString;
    }
    return baseABI;
  };

  // Live field-level feedback: digits only (decimal block height); empty
  // input clears the override back to 'latest'.
  const handleGlobalBlockChange = (value: string) => {
    setGlobalBlockNumber(value);
    const trimmed = value.trim();
    setBlockError(trimmed === '' || BLOCK_NUMBER_PATTERN.test(trimmed) ? '' : BLOCK_NUMBER_ERROR);
  };

  // Guard for the submit paths: undefined = no override (query 'latest'),
  // null = invalid input (the caller must skip the network call — an
  // unguarded BigInt() here used to throw and surface as a misleading
  // generic 'Network error'), bigint = validated override.
  const parseGlobalBlock = (): bigint | null | undefined => {
    const trimmed = globalBlockNumber.trim();
    if (trimmed === '') return undefined;
    if (!BLOCK_NUMBER_PATTERN.test(trimmed)) {
      setBlockError(BLOCK_NUMBER_ERROR);
      return null;
    }
    return BigInt(trimmed);
  };

  const loadContractFunctions = async () => {
    try {
      setLoading(true);

      // A pasted custom ABI stands in for a missing server source: parse it
      // on its own, and only layer proxy/impl ABIs when a source exists.
      const proxyABI = abiOverride ?? contractSource?.abi;

      // Diamonds: parse the merged facet ABIs as the implementation side so
      // every facet's functions reach the list (tagged 'impl').
      const effectiveImplABI = isDiamondProxy ? facetMerge.merged : implABIString;

      const functions = parseContractFunctionsUnified(proxyABI, effectiveImplABI);
      setAllFunctions(functions);
    } catch (error) {
      console.error('Failed to load contract functions:', error);
    } finally {
      setLoading(false);
    }
  };

  const callReadFunction = async (
    func: EnhancedContractFunction,
    args: unknown[],
    rawArgs: string[],
    _value?: string,
    _from?: string,
  ) => {
    // The result key carries the canonical signature: same-name overloads
    // with identical raw args must never share a result slot.
    const key = `${functionSignature(func)}-${argsKey(rawArgs)}-${globalBlockNumber.trim() || 'latest'}`;

    // Invalid block override: field-level error, no network call.
    const blockOverride = parseGlobalBlock();
    if (blockOverride === null) {
      return;
    }

    try {
      setLoadingStates(prev => ({ ...prev, [key]: true }));
      setErrors(prev => ({ ...prev, [key]: '' }));

      const targetABI = resolveTargetABI();
      if (!targetABI) {
        setErrors(prev => ({
          ...prev,
          [key]: 'Contract ABI not available',
        }));
        return;
      }

      const result = await readContract({
        chainId,
        contractAddress,
        functionName: func.name,
        args,
        abi: targetABI,
        blockNumber: blockOverride,
      });

      if (result.success) {
        setResults(prev => ({ ...prev, [key]: result.result }));
      } else {
        setErrors(prev => ({
          ...prev,
          [key]: result.error ?? 'Unknown error',
        }));
      }
    } catch (error) {
      console.error('Read function call failed:', error);
      // Faithful message: API/encode errors keep their text; only actual
      // transport failures read as network errors.
      setErrors(prev => ({ ...prev, [key]: describeCallError(error) }));
    } finally {
      setLoadingStates(prev => ({ ...prev, [key]: false }));
    }
  };

  const simulateWriteFunction = async (
    func: EnhancedContractFunction,
    args: unknown[],
    rawArgs: string[],
    value?: string,
    from?: string,
  ) => {
    // Signature-keyed like the read path: same-name write overloads with
    // identical raw args/value/from must never share a result slot.
    const key = `${functionSignature(func)}-${argsKey(rawArgs)}-${value ?? ''}-${from ?? ''}`;

    // The simulate path ignores the block override, but an invalid entry is
    // still flagged at the field so the user sees why the screen disagrees.
    if (parseGlobalBlock() === null) {
      return;
    }

    try {
      setLoadingStates(prev => ({ ...prev, [key]: true }));
      setErrors(prev => ({ ...prev, [key]: '' }));

      const targetABI = resolveTargetABI();
      if (!targetABI) {
        setErrors(prev => ({
          ...prev,
          [key]: 'Contract ABI not available',
        }));
        return;
      }

      const result = await simulateContract({
        chainId,
        contractAddress,
        functionName: func.name,
        args,
        value: value ? BigInt(value) : undefined,
        from,
        abi: targetABI,
      });

      if (result.success) {
        setResults(prev => ({
          ...prev,
          [key]: {
            result: result.result,
            gasUsed: result.gasUsed?.toString(),
          },
        }));
      } else {
        setErrors(prev => ({
          ...prev,
          [key]: result.error ?? 'Unknown error',
        }));
      }
    } catch (error) {
      console.error('Simulate function call failed:', error);
      // Same faithful classification as the read path.
      setErrors(prev => ({ ...prev, [key]: describeCallError(error) }));
    } finally {
      setLoadingStates(prev => ({ ...prev, [key]: false }));
    }
  };

  const isProxyMode = contractSource?.isProxy && !!contractSource?.implementationContract;
  const implName = contractSource?.implementationContract?.name;

  const title =
    mode === 'read'
      ? `Read as Proxy${implName ? ` (${implName})` : ''}`
      : mode === 'write'
        ? `Write as Proxy${implName ? ` (${implName})` : ''}`
        : 'Contract Interaction';

  if (loading) {
    return (
      <div className={cardStyles}>
        <h2>{title}</h2>
        <div>Loading contract functions...</div>
      </div>
    );
  }

  const targetABI = resolveTargetABI();

  // An abiOverride alone is a fully usable ABI: only the total absence of a
  // target ABI (no server source, no paste) locks the panel.
  if (!targetABI) {
    return (
      <div className={cardStyles}>
        <h2>{title}</h2>
        <div>Contract ABI not available</div>
      </div>
    );
  }

  const filteredFunctions = filterFunctions(allFunctions, {
    ...filters,
    source: contractTarget ?? 'all',
    name: debouncedNameFilter,
  });

  return (
    <>
      {isProxyMode && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: '16px',
            background: '#f0f7ff',
            border: '1px solid #c6dfff',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#1a56db',
          }}
        >
          {contractTarget === 'proxy'
            ? 'Interacting with the proxy contract itself (admin functions).'
            : isDiamondProxy
              ? 'Interacting via the diamond proxy address — the function list merges every facet\u2019s ABI.'
              : 'Interacting with implementation contract via proxy address.'}
          {!isDiamondProxy && contractSource.implementationAddress && (
            <span style={{ marginLeft: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
              Implementation: {contractSource.implementationAddress}
            </span>
          )}
        </div>
      )}

      {/* Diamond merge honesty notes: facets whose ABI never arrived (or is
          unverified) and shared function signatures kept from the first
          facet are named instead of silently narrowing the surface. */}
      {isDiamondProxy &&
        contractTarget !== 'proxy' &&
        (facetMerge.unavailable.length > 0 || facetMerge.skippedSignatures.length > 0) && (
        <div role="status" className={facetNoteStyles}>
          {facetMerge.unavailable.length > 0 && (
            <div>
              ABI unavailable for {facetMerge.unavailable.join(', ')} — those facets'
              functions are not offered.
            </div>
          )}
          {facetMerge.skippedSignatures.length > 0 && (
            <div>
              Shared function signatures kept from the first facet:{' '}
              {facetMerge.skippedSignatures.join(', ')}.
            </div>
          )}
        </div>
      )}

      <div className={filterControlsStyles}>
        <div className={filterGroupStyles}>
          <label className={filterLabelStyles}>Type:</label>
          <select
            value={filters.readWrite}
            onChange={e =>
              setFilters(prev => ({ ...prev, readWrite: e.target.value as ReadWriteFilter }))}
            className={filterSelectStyles}
          >
            <option value="all">All</option>
            <option value="read">Read</option>
            <option value="write">Write</option>
          </select>
        </div>

        <div className={filterGroupStyles}>
          <label className={filterLabelStyles}>Name:</label>
          <input
            type="text"
            value={filters.name}
            onChange={e => setFilters(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Filter by name..."
            className={filterInputStyles}
          />
        </div>

        <div className={blockGroupStyles}>
          <label className={filterLabelStyles}>Block:</label>
          <input
            type="text"
            value={globalBlockNumber}
            onChange={e => handleGlobalBlockChange(e.target.value)}
            placeholder="Latest"
            aria-label="Block number override"
            className={filterInputStyles}
          />
          <button
            type="button"
            onClick={() => {
              setGlobalBlockNumber('');
              setBlockError('');
            }}
            className={resetButtonStyles}
          >
            Reset
          </button>
          {blockError && (
            <div role="alert" className={blockErrorStyles}>
              {blockError}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: '16px', fontSize: '14px', color: '#666' }}>
        Write functions are simulations only. To execute transactions, use a Web3 wallet.
      </div>

      {filteredFunctions.length > 0 ? (
        <div className={functionListStyles}>
          {filteredFunctions.map((func, index) => (
            <FunctionCallForm
              key={`${func.source}-${func.interactionType}-${index}`}
              func={func}
              onCall={func.interactionType === 'read' ? callReadFunction : simulateWriteFunction}
              results={results}
              errors={errors}
              loadingStates={loadingStates}
              chainId={chainId}
              blockNumber={globalBlockNumber}
            />
          ))}
        </div>
      ) : (
        <div className={cardStyles}>
          <h2>{title}</h2>
          <div>No functions match the current filters</div>
        </div>
      )}
    </>
  );
}
