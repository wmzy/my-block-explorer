import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { css } from '@linaria/core';
import { numberToHex, parseEther, type Abi, type StateOverride as ViemStateOverride } from 'viem';
import { getChainInfo, getChainName, getChainSymbol, getDefaultRpcUrl } from '@/config/chains';
import { Collapsible } from '@/components/ui/Collapsible';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { getFunctionSelector, formatSelectorForDisplay } from '@/utils/functionSelector';
import { buildCastCommand } from '@/utils/castCommand';
import { formatResultWithLinks } from '@/utils/addressTypeDetection';
import { functionSignature, type EnhancedContractFunction } from '@/utils/contractInteraction';
import {
  ensureWalletChain,
  isUserRejected,
  providerErrorMessage,
  requestAccounts,
  sendWalletTransaction,
  walletChainId,
  type EIP1193Provider,
} from '@/util/wallet';
import { describeRevertedCall, parseFunctionArgs, ADDRESS_PATTERN } from './paramParsing';
import { parseStateOverrideInput, toViemStateOverride } from './stateOverrideInput';
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

// Foundry-style state-override map: mono textarea (same palette as the
// argument inputs) with room for a few lines of JSON.
const stateOverrideTextareaStyles = css`
  display: block;
  width: 100%;
  min-height: 72px;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
`;

// Honesty note inside the override disclosure: the map shapes the
// simulated eth_call only — the broadcast path can never carry it.
const stateOverrideNoteStyles = css`
  margin-top: 6px;
  font-size: 12px;
  color: #888;
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

// Wallet send sits beside Simulate but must never be mistaken for it:
// the broadcast action takes the success-card green, not simulate orange.
const buttonSendStyles = css`
  background: #2e7d32;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #256a29;
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
`;

// One-line trust note under the footer when the send action is offered.
const walletNoteStyles = css`
  margin-top: 6px;
  font-size: 12px;
  color: #888;
`;

// Quiet wallet outcomes (user rejection, chain-switch notes): muted, no
// error palette — a decision is not a failure.
const walletQuietStyles = css`
  margin-top: 8px;
  font-size: 13px;
  color: #666;
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
  /* Revert payloads can be one long hex run: wrap anywhere instead of
     pushing the card wide. */
  overflow-wrap: anywhere;
`;

const selectorStyles = css`
  font-family: monospace;
  font-size: 11px;
  padding: 2px 6px;
  background: #e8f0fe;
  border-radius: 4px;
  color: #1a73e8;
`;

// Wallet-send lifecycle for one form. 'rejected' is the user's own 4001
// decision (quiet inline note); 'error' keeps the provider message
// verbatim; 'sent' carries the broadcast hash for the internal tx link.
type WalletSendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; txHash: string }
  | { phase: 'rejected' }
  | { phase: 'error'; message: string };

// One collapsible form per function: typed argument inputs (payable adds
// an ETH value field plus from), Query vs Simulate submit, and per-call
// result/error slots keyed by call signature. When an injected EIP-1193
// wallet is available, write functions additionally offer to broadcast
// the SAME encoded call via eth_sendTransaction. `initialArgs` pre-fills
// the argument inputs once on mount (the revoke intent lands the user on
// a ready-to-send form); the user's edits always win afterwards.
export function FunctionCallForm({
  func,
  onCall,
  results,
  errors,
  loadingStates,
  chainId,
  blockNumber,
  contractAddress,
  walletProvider = null,
  abi,
  initialArgs,
  defaultExpanded = false,
}: {
  func: EnhancedContractFunction;
  onCall: (
    func: EnhancedContractFunction,
    args: unknown[],
    rawArgs: string[],
    value?: string,
    from?: string,
    /** Validated eth_call state override (foundry parity); write forms only. */
    stateOverride?: ViemStateOverride,
  ) => void;
  results: Record<string, unknown>;
  errors: Record<string, string>;
  loadingStates: Record<string, boolean>;
  chainId: number;
  blockNumber: string;
  /** Target address for the cast command copy actions. */
  contractAddress?: string;
  /** Injected wallet (EIP-1193) enabling the send action; null hides it. */
  walletProvider?: EIP1193Provider | null;
  /** The panel's resolved contract ABI — decodes revert data of failed sends. */
  abi?: Abi;
  /**
   * Raw prefill strings for the argument inputs (same shapes a user would
   * type), applied once on mount and re-applied only when this payload
   * itself changes — never fighting user edits or the composite-arg
   * parsing, which sees the values as ordinary input text.
   */
  initialArgs?: readonly string[];
  /** Start expanded (a revoke intent lands the user on the ready form). */
  defaultExpanded?: boolean;
}) {
  const [args, setArgs] = useState<string[]>(() =>
    func.inputs.map((_, index) => initialArgs?.[index] ?? ''),
  );
  const [argErrors, setArgErrors] = useState<string[]>(func.inputs.map(() => ''));
  const [value, setValue] = useState('');
  const [valueError, setValueError] = useState('');
  const [from, setFrom] = useState('');
  const [fromError, setFromError] = useState('');
  // Foundry-style state overrides: raw textarea text parsed on submit (not
  // per keystroke), with the same field-level blocking as the arguments.
  const [stateOverrideText, setStateOverrideText] = useState('');
  const [stateOverrideErrors, setStateOverrideErrors] = useState<string[]>([]);

  // Re-prefill when the prefill PAYLOAD changes (e.g. the route carries a
  // different ?revoke= intent into the same mounted form): the serialized
  // key only moves when the payload does, so user edits between intent
  // switches are never clobbered.
  const initialArgsKey = initialArgs === undefined ? '' : initialArgs.join('\u0000');
  useEffect(() => {
    if (initialArgsKey === '') return;
    setArgs(prev => {
      const next = func.inputs.map((_, index) => initialArgs?.[index] ?? '');
      return next.length === prev.length && next.every((entry, index) => entry === prev[index])
        ? prev
        : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-prefill only when the prefill payload changes
  }, [initialArgsKey]);

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

  // --- Shared call encoding ------------------------------------------------
  //
  // One buildCastCommand pass feeds every consumer of the form's current
  // state: the cast copy actions AND the wallet send, which must broadcast
  // exactly the bytes the Simulate path would run (same parsing, same
  // trailing-empty omission, same viem encoder). The rpcUrl only shapes
  // the pasted command's text — the calldata is RPC-independent.
  const encodedCall =
    contractAddress === undefined
      ? ({ ok: false as const, reason: 'contract address unavailable' })
      : isPayable && value.trim() !== '' && valueWei === ''
        ? { ok: false as const, reason: `Invalid ${nativeSymbol} amount` }
        : buildCastCommand({
            func,
            rawArgs: args,
            contractAddress,
            rpcUrl: getDefaultRpcUrl(chainId),
            valueWei: isPayable && valueWei !== '' ? valueWei : undefined,
          });

  // The pasted command additionally requires a known default RPC (its
  // weakest link); the wallet send deliberately does not — the wallet
  // uses its own endpoint.
  const castCommand =
    encodedCall.ok && getDefaultRpcUrl(chainId) === ''
      ? { ok: false as const, reason: 'no default RPC URL known for this chain' }
      : encodedCall;

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

  // --- Wallet send ---------------------------------------------------------
  //
  // Broadcasts the SAME encoded call the Simulate path runs, through the
  // injected provider. Outcomes render inline: a broadcast hash links to
  // this explorer's own tx page, a user rejection stays quiet, and every
  // other provider error keeps its message verbatim.
  const [walletSend, setWalletSend] = useState<WalletSendState>({ phase: 'idle' });
  const [walletSwitchNote, setWalletSwitchNote] = useState<string | null>(null);

  const showsWalletSend = func.interactionType === 'write' && walletProvider !== null;

  const handleSendWithWallet = async (): Promise<void> => {
    // Capture before any await: property narrowing does not survive the
    // async boundary, locals do.
    const calldata = encodedCall.ok ? encodedCall.calldata : null;
    if (walletProvider === null || contractAddress === undefined || calldata === null) return;

    setWalletSwitchNote(null);
    setWalletSend({ phase: 'sending' });
    try {
      // Chain guard: the route's chain vs the wallet's active chain. A
      // mismatch walks the switch/add flow first; the outcome is named
      // inline and a rejection aborts before any tx is built.
      const activeChain = await walletChainId(walletProvider);
      if (activeChain !== null && activeChain !== chainId) {
        const outcome = await ensureWalletChain(walletProvider, getChainInfo(chainId));
        if (outcome === 'rejected') {
          setWalletSwitchNote(
            `Rejected in wallet — wallet stayed on ${getChainName(activeChain)}.`,
          );
          setWalletSend({ phase: 'idle' });
          return;
        }
        if (outcome === 'unknown_chain') {
          setWalletSwitchNote(
            `Unknown chain to this wallet — add chainId ${chainId} in the wallet and retry.`,
          );
          setWalletSend({ phase: 'idle' });
          return;
        }
        if (outcome === 'switched') {
          setWalletSwitchNote(`Wallet switched to ${getChainName(chainId)}.`);
        }
      }

      // Also serves as the wallet-unlock prompt; the tx always sends from
      // the wallet's first account.
      const accounts = await requestAccounts(walletProvider);
      if (accounts.length === 0) {
        setWalletSend({ phase: 'error', message: 'No accounts available in wallet' });
        return;
      }

      // No gas limit on purpose: the wallet estimates — a hardcoded value
      // here would be a guess, and a wrong one would strand the tx.
      const tx = {
        from: accounts[0],
        to: contractAddress,
        data: calldata,
        ...(isPayable && valueWei !== '' ? { value: numberToHex(BigInt(valueWei)) } : {}),
      };
      const txHash = await sendWalletTransaction(walletProvider, tx);
      setWalletSend({ phase: 'sent', txHash });
    } catch (error) {
      // 4001 is the user's own decision: quiet inline note, no error card.
      if (isUserRejected(error)) {
        setWalletSend({ phase: 'rejected' });
        return;
      }
      // A provider revert with decodable data leads with the decoded custom
      // error (ContractFunctionReverted: Name(args)); every other provider
      // error keeps its message verbatim.
      const reverted = describeRevertedCall(error, abi);
      setWalletSend({ phase: 'error', message: reverted ?? providerErrorMessage(error) });
    }
  };

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

    // State overrides parse on submit (not per keystroke): a bad JSON map
    // blocks the simulate exactly like a bad argument above, with the
    // parser's field-path sentences rendered under the textarea.
    const stateOverride = parseStateOverrideInput(stateOverrideText);
    setStateOverrideErrors(stateOverride.ok ? [] : stateOverride.errors);

    if (!isValid || newValueError !== '' || newFromError !== '' || !stateOverride.ok) {
      return;
    }

    onCall(
      func,
      values,
      args,
      wei,
      fromTrimmed || undefined,
      stateOverride.value === undefined
        ? undefined
        : toViemStateOverride(stateOverride.value),
    );
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
    <Collapsible title={headerTitle} defaultExpanded={defaultExpanded} badge={badge}>
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

            {/* Foundry-style state overrides: collapsed by default, the
                JSON map parses on submit and invalid input blocks the
                simulate with field-path sentences under the textarea. */}
            <div className={inputGroupStyles}>
              <Collapsible title="State overrides (advanced)">
                <label className={labelStyles}>
                  Override map (JSON)
                  <textarea
                    value={stateOverrideText}
                    onChange={e => {
                      setStateOverrideText(e.target.value);
                      if (stateOverrideErrors.length > 0) {
                        setStateOverrideErrors([]);
                      }
                    }}
                    placeholder='{"0x0000000000000000000000000000000000000000":{"balance":"0x1"}}'
                    spellCheck={false}
                    className={stateOverrideTextareaStyles}
                  />
                </label>
                {stateOverrideErrors.length > 0 && (
                  <div role="alert" className={fieldErrorStyles}>
                    {stateOverrideErrors.map(message => (
                      <div key={message}>{message}</div>
                    ))}
                  </div>
                )}
                {/* Honesty note: the override shapes the simulated eth_call
                    only — the wallet broadcast path never sees it. */}
                <div className={stateOverrideNoteStyles}>
                  Applies to the simulated eth_call only — never attached to
                  wallet sends, never broadcast, never persisted.
                </div>
              </Collapsible>
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

          {/* Broadcast action — only when an injected wallet exists. Shares
              the encodedCall validation with the cast actions, so it is
              enabled exactly when the current form state encodes. */}
          {showsWalletSend && (
            <button
              type="button"
              className={buttonSendStyles}
              disabled={!encodedCall.ok || walletSend.phase === 'sending'}
              onClick={() => void handleSendWithWallet()}
              title={
                encodedCall.ok
                  ? 'Broadcast this call from your wallet (eth_sendTransaction) — the wallet estimates gas and confirms'
                  : encodedCall.reason
              }
            >
              {walletSend.phase === 'sending' ? 'Sending...' : 'Send with wallet'}
            </button>
          )}

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

        {/* Trust note: the send action broadcasts from the user's own
            wallet; this explorer only ever sees public bytes. */}
        {showsWalletSend && (
          <div className={walletNoteStyles}>
            Sent from your wallet; this explorer never sees your keys.
          </div>
        )}

        {/* Chain-switch outcome from the send guard — named, never silent. */}
        {walletSwitchNote && (
          <div role="status" className={walletQuietStyles}>
            {walletSwitchNote}
          </div>
        )}

        {/* Quiet user rejection (4001): a decision, not an error card. */}
        {walletSend.phase === 'rejected' && (
          <div role="status" className={walletQuietStyles}>
            Rejected in wallet
          </div>
        )}

        {/* Broadcast success: the hash links to this explorer's own tx
            page (route verified in views/index.tsx). */}
        {walletSend.phase === 'sent' && (
          <div className={resultSuccessStyles}>
            <div className={resultTitleStyles}>Sent — transaction broadcast:</div>
            <div className={resultContentStyles}>
              <CopyableHash
                value={walletSend.txHash}
                href={`/chain/${chainId}/tx/${walletSend.txHash}`}
              />
            </div>
          </div>
        )}

        {/* Other provider errors: attributed inline, message verbatim. */}
        {walletSend.phase === 'error' && (
          <div className={functionErrorStyles}>
            <div className={functionErrorTitleStyles}>Wallet send error:</div>
            <div className={functionErrorContentStyles}>{walletSend.message}</div>
          </div>
        )}

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
