import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { css } from '@linaria/core';
import { parseEther } from 'viem';
import { getChainSymbol, getDefaultRpcUrl } from '@/config/chains';
import { Collapsible } from '@/components/ui/Collapsible';
import { getFunctionSelector, formatSelectorForDisplay } from '@/utils/functionSelector';
import { buildCastCommand } from '@/utils/castCommand';
import { formatResultWithLinks } from '@/utils/addressTypeDetection';
import { functionSignature, type EnhancedContractFunction } from '@/utils/contractInteraction';
import { parseFunctionArgs, ADDRESS_PATTERN } from './paramParsing';
import { argsKey } from './types';

const functionNameReadStyles = css`
  font-weight: 600;
  margin-bottom: 12px;
  color: #0066cc;
`;

const functionNameWriteStyles = css`
  font-weight: 600;
  margin-bottom: 12px;
  color: #cc6600;
`;

const mutabilityStyles = css`
  font-size: 12px;
  font-weight: normal;
  margin-left: 8px;
  color: #666;
`;

const inputGroupStyles = css`
  margin-bottom: 12px;
`;

const labelStyles = css`
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
  color: #333;
`;

const inputStyles = css`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
`;

const fieldErrorStyles = css`
  margin-top: 4px;
  font-size: 12px;
  color: #c62828;
`;

const weiHintStyles = css`
  margin-top: 4px;
  font-family: monospace;
  font-size: 11px;
  color: #888;
  word-break: break-all;
`;

const buttonReadStyles = css`
  background: #0066cc;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #0052a3;
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
`;

const buttonWriteStyles = css`
  background: #cc6600;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #b85c00;
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
`;

// Submit plus the two cast-copy actions share one footer row.
const formFooterStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

// Secondary outline style so the copy actions never compete with the
// primary Query/Simulate submit.
const copyButtonStyles = css`
  background: white;
  color: #0066cc;
  border: 1px solid #0066cc;
  padding: 7px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #e8f0fe;
  }

  &:disabled {
    color: #999;
    border-color: #ccc;
    background: #f5f5f5;
    cursor: not-allowed;
  }
`;

const resultSuccessStyles = css`
  margin-top: 12px;
  padding: 12px;
  background: #e8f5e8;
  border-radius: 4px;
  border: 1px solid #4caf50;
`;

const resultTitleStyles = css`
  font-size: 14px;
  font-weight: 600;
  color: #2e7d32;
  margin-bottom: 8px;
`;

// Compact marker repeated on every write result card: a scrolled-down user
// must never mistake a simulation for a broadcast transaction.
const simulatedTagStyles = css`
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  background: #fff3cd;
  color: #856404;
`;

const resultContentStyles = css`
  font-family: monospace;
  font-size: 12px;
  color: #1b5e20;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
`;

const functionErrorStyles = css`
  margin-top: 12px;
  padding: 12px;
  background: #ffebee;
  border-radius: 4px;
  border: 1px solid #f44336;
`;

const functionErrorTitleStyles = css`
  font-size: 14px;
  font-weight: 600;
  color: #c62828;
  margin-bottom: 8px;
`;

const functionErrorContentStyles = css`
  font-size: 13px;
  color: #b71c1c;
`;

const selectorStyles = css`
  font-family: monospace;
  font-size: 11px;
  padding: 2px 6px;
  background: #e8f0fe;
  border-radius: 4px;
  color: #1a73e8;
`;

// One collapsible form per function: typed argument inputs (payable adds
// an ETH value field plus from), Query vs Simulate submit, and per-call
// result/error slots keyed by call signature.
export function FunctionCallForm({
  func,
  onCall,
  results,
  errors,
  loadingStates,
  chainId,
  blockNumber,
  contractAddress,
}: {
  func: EnhancedContractFunction;
  onCall: (
    func: EnhancedContractFunction,
    args: unknown[],
    rawArgs: string[],
    value?: string,
    from?: string,
  ) => void;
  results: Record<string, unknown>;
  errors: Record<string, string>;
  loadingStates: Record<string, boolean>;
  chainId: number;
  blockNumber: string;
  /** Target address for the cast command copy actions. */
  contractAddress?: string;
}) {
  const [args, setArgs] = useState<string[]>(func.inputs.map(() => ''));
  const [argErrors, setArgErrors] = useState<string[]>(func.inputs.map(() => ''));
  const [value, setValue] = useState('');
  const [valueError, setValueError] = useState('');
  const [from, setFrom] = useState('');
  const [fromError, setFromError] = useState('');

  const selector = getFunctionSelector(func);
  const selectorDisplay = formatSelectorForDisplay(selector);

  // The payable value field is denominated in the chain's native currency —
  // 'ETH' only makes sense on Ethereum.
  const nativeSymbol = getChainSymbol(chainId);

  const isPayable = func.interactionType === 'write' && func.stateMutability === 'payable';

  // Wei equivalent of the current native-currency input; '' when empty or
  // not (yet) parseable. Used both as the key fragment shared with the
  // parent and as the wei helper display under the field.
  const valueWei = (() => {
    const trimmed = value.trim();
    if (trimmed === '') return '';
    try {
      return parseEther(trimmed).toString();
    } catch {
      return '';
    }
  })();

  // --- Copy-as-cast support ------------------------------------------------
  //
  // A paste-ready foundry `cast` command for the CURRENT form state,
  // rebuilt every render (pure, cheap): the same validation and the same
  // viem encoding the submit path uses decide whether a command exists at
  // all. When it does not, the reason (first invalid field) becomes the
  // disabled buttons' tooltip.
  const castCommand = (() => {
    if (contractAddress === undefined) {
      return { ok: false as const, reason: 'contract address unavailable' };
    }
    const rpcUrl = getDefaultRpcUrl(chainId);
    if (rpcUrl === '') {
      return { ok: false as const, reason: 'no default RPC URL known for this chain' };
    }
    // Same rule as the submit validation: a payable amount that will not
    // parse blocks everything, mirroring the field-level error.
    if (isPayable && value.trim() !== '' && valueWei === '') {
      return { ok: false as const, reason: `Invalid ${nativeSymbol} amount` };
    }
    return buildCastCommand({
      func,
      rawArgs: args,
      contractAddress,
      rpcUrl,
      valueWei: isPayable && valueWei !== '' ? valueWei : undefined,
    });
  })();

  // Label-swap feedback for the copy buttons (SourceCodeViewer/RawJson
  // pattern): the button itself reports the honest clipboard outcome.
  const [copyFeedback, setCopyFeedback] = useState<{
    which: 'cast' | 'calldata';
    ok: boolean;
  } | null>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async (which: 'cast' | 'calldata', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback({ which, ok: true });
    } catch {
      setCopyFeedback({ which, ok: false });
    }
    if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyFeedback(null), 2000);
  };

  const copyLabel = (which: 'cast' | 'calldata', idle: string) =>
    copyFeedback?.which === which ? (copyFeedback.ok ? 'Copied ✓' : 'Copy failed') : idle;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    // Parse each raw input against its ABI type: composite inputs (arrays,
    // tuples) become real JS values, scalars are validated, and every
    // failure lands on its own field instead of surfacing after submit as
    // a generic encoding error.
    const { values, fieldErrors, isValid } = parseFunctionArgs(func.inputs, args);
    setArgErrors(fieldErrors);

    // Payable value is entered in the chain's native currency and converted
    // to wei via parseEther. Validate here so an invalid amount gets a
    // field-level error instead of surfacing as a generic network error
    // after submission.
    let newValueError = '';
    let wei: string | undefined;
    if (isPayable && value.trim() !== '') {
      try {
        wei = parseEther(value.trim()).toString();
      } catch {
        newValueError = `Invalid ${nativeSymbol} amount`;
      }
    }
    setValueError(newValueError);

    // From is optional, but a non-empty entry must be a 0x address: block
    // the submit at the field instead of failing the simulated call later.
    const fromTrimmed = from.trim();
    let newFromError = '';
    if (fromTrimmed !== '' && !ADDRESS_PATTERN.test(fromTrimmed)) {
      newFromError = 'invalid address';
    }
    setFromError(newFromError);

    if (!isValid || newValueError !== '' || newFromError !== '') {
      return;
    }

    onCall(func, values, args, wei, fromTrimmed || undefined);
  };

  const getResultKey = () => {
    // Mirrors the parent's key derivation (canonical signature, trimmed
    // override, 'latest' when empty) so a result written by the parent for
    // THIS overload — not a same-name sibling — is found here.
    if (func.interactionType === 'read') {
      return `${functionSignature(func)}-${argsKey(args)}-${blockNumber.trim() || 'latest'}`;
    } else {
      return `${functionSignature(func)}-${argsKey(args)}-${valueWei}-${from.trim()}`;
    }
  };

  const resultKey = getResultKey();
  const result = results[resultKey];
  const error = errors[resultKey];
  const isLoading = loadingStates[resultKey];

  const headerTitle = (
    <span
      className={func.interactionType === 'read' ? functionNameReadStyles : functionNameWriteStyles}
    >
      {func.name}
      <span className={mutabilityStyles}>{func.stateMutability}</span>
    </span>
  );

  const badge = (
    <span style={{ display: 'flex', gap: '4px' }}>
      {selectorDisplay && <span className={selectorStyles}>{selectorDisplay}</span>}
      <span
        className={selectorStyles}
        style={{ background: func.interactionType === 'read' ? '#d4edda' : '#fff3cd' }}
      >
        {func.interactionType}
      </span>
      <span className={selectorStyles} style={{ background: '#e8f0fe' }}>
        {func.source}
      </span>
    </span>
  );

  // An input may be left empty only when every following input is empty
  // too — that trailing run is omitted from the encoded call — so the
  // placeholder advertises the option exactly where it applies.
  const isOmittable = (index: number) => args.slice(index + 1).every(arg => arg.trim() === '');

  return (
    <Collapsible title={headerTitle} defaultExpanded={false} badge={badge}>
      <form onSubmit={handleSubmit}>
        {/* Function Arguments */}
        {func.inputs.map((input, index) => (
          <div key={index} className={inputGroupStyles}>
            {/* The input lives inside its label so screen readers (and
                tests) can associate the typed field with its name. */}
            <label className={labelStyles}>
              {input.name} ({input.type})
              <input
                type="text"
                value={args[index]}
                onChange={e => {
                  const newArgs = [...args];
                  newArgs[index] = e.target.value;
                  setArgs(newArgs);
                  if (argErrors[index]) {
                    const newErrors = [...argErrors];
                    newErrors[index] = '';
                    setArgErrors(newErrors);
                  }
                }}
                placeholder={
                  isOmittable(index) ? 'optional — leave empty to omit' : `Enter ${input.type}`
                }
                className={inputStyles}
              />
            </label>
            {argErrors[index] && <div className={fieldErrorStyles}>{argErrors[index]}</div>}
          </div>
        ))}

        {/* Write function additional fields */}
        {func.interactionType === 'write' && (
          <>
            {func.stateMutability === 'payable' && (
              <div className={inputGroupStyles}>
                {/* Same nesting as the argument inputs: the input lives
                    inside its label so screen readers (and tests) can
                    associate the typed field with its name. */}
                <label className={labelStyles}>
                  Value ({nativeSymbol})
                  <input
                    type="text"
                    value={value}
                    onChange={e => {
                      setValue(e.target.value);
                      setValueError('');
                    }}
                    placeholder="0"
                    className={inputStyles}
                  />
                </label>
                {valueWei && <div className={weiHintStyles}>= {valueWei} wei</div>}
                {valueError && <div className={fieldErrorStyles}>{valueError}</div>}
              </div>
            )}

            <div className={inputGroupStyles}>
              <label className={labelStyles}>
                From Address (optional)
                <input
                  type="text"
                  value={from}
                  onChange={e => {
                    setFrom(e.target.value);
                    setFromError('');
                  }}
                  placeholder="0x..."
                  className={inputStyles}
                />
              </label>
              {fromError && <div className={fieldErrorStyles}>{fromError}</div>}
            </div>
          </>
        )}

        <div className={formFooterStyles}>
          <button
            type="submit"
            disabled={isLoading}
            className={func.interactionType === 'read' ? buttonReadStyles : buttonWriteStyles}
          >
            {isLoading ? 'Loading...' : func.interactionType === 'read' ? 'Query' : 'Simulate'}
          </button>

          {/* Disabled with the first offending field as tooltip until the
              current args would encode — the copied command must never be
              a guess. The RPC caveat stays visible while enabled so the
              pasteable command's weakest link (a public endpoint) is
              always disclosed. */}
          <button
            type="button"
            className={copyButtonStyles}
            disabled={!castCommand.ok}
            onClick={() =>
              void handleCopy('cast', castCommand.ok ? castCommand.command : '')}
            title={
              castCommand.ok
                ? 'Copy a runnable foundry cast command — uses the chain\'s default public RPC; replace with your own endpoint if rate-limited'
                : castCommand.reason
            }
          >
            {copyLabel('cast', 'Copy as cast')}
          </button>
          <button
            type="button"
            className={copyButtonStyles}
            disabled={!castCommand.ok}
            onClick={() =>
              void handleCopy('calldata', castCommand.ok ? castCommand.calldata : '')}
            title={
              castCommand.ok
                ? 'Copy the ABI-encoded calldata (0x…) for this call'
                : castCommand.reason
            }
          >
            {copyLabel('calldata', 'Copy calldata')}
          </button>
        </div>

        {/* Results */}
        {result !== undefined && (
          <div className={resultSuccessStyles}>
            <div className={resultTitleStyles}>
              Result:
              {func.interactionType === 'write' && (
                <span className={simulatedTagStyles}>simulated — not sent</span>
              )}
            </div>
            <div className={resultContentStyles}>
              {typeof result === 'object'
                ? formatResultWithLinks(result, {
                    chainId,
                    outputs: func.outputs,
                  })
                : String(result)}
            </div>
          </div>
        )}

        {/* Errors */}
        {error && (
          <div className={functionErrorStyles}>
            <div className={functionErrorTitleStyles}>Error:</div>
            <div className={functionErrorContentStyles}>{error}</div>
          </div>
        )}
      </form>
    </Collapsible>
  );
}
