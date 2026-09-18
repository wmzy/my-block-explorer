import { useState, useEffect } from 'react';
import { css } from '@linaria/core';
import {
  parseContractFunctionsUnified,
  filterFunctions,
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

// The block override feeds viem's bigint `blockNumber` parameter directly —
// this call path supports no named tags ('latest', 'safe', ...) — so only
// plain decimal digits are acceptable. Empty input means 'latest'.
const BLOCK_NUMBER_PATTERN = /^\d+$/;
const BLOCK_NUMBER_ERROR = 'Enter a block number';

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

  useEffect(() => {
    if (contractSource?.abi || abiOverride) {
      loadContractFunctions();
    } else {
      // Nothing to parse without an ABI: stop loading so the
      // 'Contract ABI not available' fallback below is reachable instead
      // of an endless spinner.
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the contract data itself changes
  }, [chainId, contractAddress, contractSource, abiOverride]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedNameFilter(filters.name);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.name]);

  // ABI that a read/simulate call is routed against. For a real proxy pair
  // the target selector decides: 'proxy' targets the proxy's own ABI (its
  // admin functions), anything else targets the implementation ABI (the
  // pre-existing default). Without a proxy pair the base ABI wins — the
  // override standing in for a missing server-supplied ABI.
  const resolveTargetABI = (): string | undefined => {
    const baseABI = abiOverride ?? contractSource?.abi;
    const implABI =
      contractSource?.isProxy && contractSource.implementationContract?.abi
        ? contractSource.implementationContract.abi
        : undefined;

    if (implABI) {
      return contractTarget === 'proxy' ? baseABI : implABI;
    }
    return baseABI;
  };

  // Live field-level feedback: digits only (decimal block height); empty
  // input clears the override back to 'latest'.
  const handleGlobalBlockChange = (value: string) => {
    setGlobalBlockNumber(value);
    const trimmed = value.trim();
    setBlockError(
      trimmed === '' || BLOCK_NUMBER_PATTERN.test(trimmed) ? '' : BLOCK_NUMBER_ERROR,
    );
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
      const implABI =
        contractSource?.isProxy && contractSource.implementationContract
          ? contractSource.implementationContract.abi
          : undefined;

      const functions = parseContractFunctionsUnified(proxyABI, implABI);
      setAllFunctions(functions);
    } catch (error) {
      console.error('Failed to load contract functions:', error);
    } finally {
      setLoading(false);
    }
  };

  const callReadFunction = async (
    functionName: string,
    args: unknown[],
    rawArgs: string[],
    _value?: string,
    _from?: string,
  ) => {
    const key = `${functionName}-${argsKey(rawArgs)}-${globalBlockNumber.trim() || 'latest'}`;

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
        functionName,
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
      setErrors(prev => ({ ...prev, [key]: 'Network error' }));
    } finally {
      setLoadingStates(prev => ({ ...prev, [key]: false }));
    }
  };

  const simulateWriteFunction = async (
    functionName: string,
    args: unknown[],
    rawArgs: string[],
    value?: string,
    from?: string,
  ) => {
    const key = `${functionName}-${argsKey(rawArgs)}-${value ?? ''}-${from ?? ''}`;

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
        functionName,
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
      setErrors(prev => ({ ...prev, [key]: 'Network error' }));
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
            : 'Interacting with implementation contract via proxy address.'}
          {contractSource.implementationAddress && (
            <span style={{ marginLeft: '8px', fontFamily: 'monospace', fontSize: '12px' }}>
              Implementation: {contractSource.implementationAddress}
            </span>
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
