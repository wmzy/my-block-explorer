// In-page local compile verification panel for chains the remote
// verifiers cannot cover (anvil/hardhat/private deployments): pick a solc
// build, paste the Standard JSON input (a Hardhat build-info file works
// verbatim — the backend unwraps it), and this explorer's backend
// recompiles with the official soljson build and matches the runtime
// bytecode against the chain's own RPC. Unlike the manual trust mark this
// is a real match, and the outcome tiers are honest: exact, match after
// ignoring the metadata hash, or mismatch with the first differing byte.
import { useEffect, useMemo, useState } from 'react';
import { css } from '@linaria/core';
import * as ff from 'fetch-fun';
import { get, post, isBackendUnreachable, longRunningApi } from '@/util/http';
import { ApiError } from '@/util/apiError';

// The compilers endpoint's entry shape (see CompileVerifyService).
type CompilerVersionEntry = {
  version?: string;
  longVersion?: string;
  prerelease?: boolean;
};

type CompilerListResponse = {
  versions?: CompilerVersionEntry[];
  /** Set when the list came from the local soljson cache (or is empty). */
  degraded?: string;
};

// The compile endpoint's response union (see routes/verify.ts). Fields
// stay optional — the http layer answers unknown shapes with undefined,
// never with fabricated data.
type CompileVerifyResponse = {
  verified?: boolean;
  tier?: 'exact' | 'matches-metadata-only';
  contractName?: string;
  compilerVersion?: string;
  kind?: string;
  message?: string;
  errors?: string[];
  comparison?: {
    firstDiffByteOffset?: number;
    onChainBytes?: number;
    compiledBytes?: number;
    onChainAuxdata?: string;
    compiledAuxdata?: string;
  };
};

type PanelResult =
  | {
    kind: 'verified';
    tier: 'exact' | 'matches-metadata-only';
    contractName: string;
    compilerVersion: string;
    onChainAuxdata?: string;
    compiledAuxdata?: string;
  }
  | { kind: 'mismatch'; text: string }
  | { kind: 'compile-error'; errors: string[] }
  | { kind: 'notice'; text: string }
  | { kind: 'error'; text: string };

// Compiling runs a real compiler (download on first use + wasm compile):
// the default 10s per-attempt budget would abort healthy runs, and even
// the 35s long-running budget is tight for a first-time download.
const compileApi = longRunningApi.pipe(ff.timeout, 120_000);

const panelStyles = css`
  margin-bottom: 20px;
`;

const introStyles = css`
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #666;
`;

const fieldLabelStyles = css`
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin: 10px 0 4px 0;
`;

const versionSelectStyles = css`
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #ced4da;
  max-width: 100%;
`;

const inputStyles = css`
  width: 100%;
  box-sizing: border-box;
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #ced4da;
`;

const textareaStyles = css`
  width: 100%;
  box-sizing: border-box;
  min-height: 160px;
  font-family: monospace;
  font-size: 12px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #ced4da;
  resize: vertical;
`;

const hintStyles = css`
  margin: 6px 0 0 0;
  font-size: 12px;
  color: #8a6d3b;
`;

const feedbackBadStyles = css`
  margin: 6px 0 0 0;
  font-size: 12px;
  color: #dc3545;
`;

const actionsRowStyles = css`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  flex-wrap: wrap;
`;

const submitStyles = css`
  padding: 8px 18px;
  font-size: 14px;
  border-radius: 6px;
  cursor: pointer;
  background: #007bff;
  border: 1px solid #0062cc;
  color: white;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #0069d9;
  }

  &:disabled {
    background: #a8c7ea;
    border-color: #a8c7ea;
    cursor: not-allowed;
  }
`;

const resultVerifiedStyles = css`
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
  background: #d4edda;
  border: 1px solid #c3e6cb;
  color: #155724;
`;

const resultMismatchStyles = css`
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
  word-break: break-word;
`;

const resultErrorListStyles = css`
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 12px;
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
  word-break: break-word;
  white-space: pre-wrap;
  font-family: monospace;
`;

const resultNoticeStyles = css`
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
  background: #fff8e6;
  border: 1px solid #f0a500;
  color: #8a6d3b;
  word-break: break-word;
`;

const auxdataStyles = css`
  margin-top: 6px;
  font-family: monospace;
  font-size: 11px;
  word-break: break-all;
`;

// Infra failures get plain-word attribution: which hop was unreachable
// (same taxonomy as the Sourcify panel; 0 means the explorer API never
// answered, 403 is the admin-token gate, 502 names the compile-side
// network need the backend already put into words).
const describeSubmitError = (error: unknown): string => {
  if (isBackendUnreachable(error)) {
    return 'The explorer API is unreachable — start the backend (or fix its address in ⚙ RPC settings) and try again.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'Requires admin token — set it via ⚙️ RPC → Admin token. The server must have ADMIN_TOKEN configured.';
  }
  if (error instanceof ApiError && error.status === 504) {
    return 'The compile run exceeded its time budget — try a smaller input or a compiler version already downloaded.';
  }
  return error instanceof Error ? error.message : 'Verification request failed.';
};

const truncateHex = (hex: string | undefined, chars = 64): string => {
  if (hex === undefined) return '(none)';
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  return body.length <= chars ? body : `${body.slice(0, chars)}…`;
};

// Live JSON-shape feedback for the Standard JSON textarea so a doomed 400
// never round-trips. A Hardhat build-info file passes too (the backend
// unwraps its `input` member).
type JsonFeedback =
  | { ok: true; parsed: Record<string, unknown>; buildInfo: boolean }
  | { ok: false; reason: string };

const parseJsonFeedback = (raw: string): JsonFeedback | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: 'The input must be a JSON object (Standard JSON input or a Hardhat build-info file).' };
    }
    const record = parsed as Record<string, unknown>;
    return { ok: true, parsed: record, buildInfo: record.input !== undefined };
  } catch {
    return { ok: false, reason: 'Not valid JSON — paste the Standard JSON input object (or a Hardhat build-info file verbatim).' };
  }
};

export function CompileVerifyPanel({
  chainId,
  address,
  onVerified,
}: {
  chainId: number;
  address: string;
  onVerified: () => void;
}) {
  const [versions, setVersions] = useState<CompilerVersionEntry[] | null>(null);
  const [listNote, setListNote] = useState<string | null>(null);
  const [listUnavailable, setListUnavailable] = useState<string | null>(null);
  const [userVersion, setUserVersion] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [contractNameText, setContractNameText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PanelResult | null>(null);

  // The version list is chain-independent and 24h server-cached; fetched
  // once per mount (the panel only renders while open).
  useEffect(() => {
    let cancelled = false;
    get<CompilerListResponse>(
      `/api/chains/${chainId}/contracts/${address}/verify/compilers`,
    )
      .then(data => {
        if (cancelled) return;
        setVersions(data.versions ?? []);
        setListNote(data.degraded ?? null);
      })
      .catch(error => {
        if (cancelled) return;
        setVersions([]);
        setListUnavailable(
          error instanceof Error ? error.message : 'Compiler list unavailable.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, address]);

  const jsonFeedback = useMemo(() => parseJsonFeedback(jsonText), [jsonText]);

  // A Hardhat build-info file names its compiler (solcVersion); when the
  // version select is untouched, preselect it if it exists in the list —
  // an affordance, never a silent override.
  const derivedVersion = useMemo(() => {
    if (versions === null || !jsonFeedback?.ok) return '';
    const declared = jsonFeedback.parsed.solcVersion;
    if (typeof declared !== 'string') return '';
    const match = versions.find(
      entry =>
        entry.longVersion === declared ||
        (entry.longVersion?.startsWith(`${declared}+`) ?? false) ||
        entry.version === declared,
    );
    return match?.longVersion ?? '';
  }, [versions, jsonFeedback]);

  const selectedVersion =
    userVersion !== '' ? userVersion : derivedVersion !== '' ? derivedVersion : '';
  const canSubmit =
    versions !== null &&
    versions.length > 0 &&
    selectedVersion !== '' &&
    jsonFeedback !== null &&
    jsonFeedback.ok &&
    !submitting &&
    address !== '';

  const handleSubmit = async () => {
    if (!canSubmit || !jsonFeedback?.ok) return;
    setSubmitting(true);
    setResult(null);
    try {
      // The pasted object goes to the backend verbatim: a plain Standard
      // JSON input compiles as-is, a Hardhat build-info file is unwrapped
      // server-side (its `input` member detected there).
      const response = await post<CompileVerifyResponse>(
        `/api/chains/${chainId}/contracts/${address}/verify/compile`,
        {
          compilerVersion: selectedVersion,
          standardJsonInput: jsonFeedback.parsed,
          ...(contractNameText.trim() !== '' ? { contractName: contractNameText.trim() } : {}),
        },
        compileApi,
      );
      if (response.verified === true) {
        setResult({
          kind: 'verified',
          tier: response.tier === 'matches-metadata-only' ? 'matches-metadata-only' : 'exact',
          contractName: response.contractName ?? 'unknown',
          compilerVersion: response.compilerVersion ?? selectedVersion,
          ...(response.comparison?.onChainAuxdata !== undefined
            ? { onChainAuxdata: response.comparison.onChainAuxdata }
            : {}),
          ...(response.comparison?.compiledAuxdata !== undefined
            ? { compiledAuxdata: response.comparison.compiledAuxdata }
            : {}),
        });
        onVerified();
      } else if (response.kind === 'compile_error') {
        setResult({ kind: 'compile-error', errors: response.errors ?? [] });
      } else if (response.kind === 'mismatch') {
        setResult({ kind: 'mismatch', text: response.message ?? 'The recompiled bytecode does not match.' });
      } else {
        setResult({
          kind: 'notice',
          text: response.message ?? `The backend answered "${response.kind ?? 'unknown'}" without a match.`,
        });
      }
    } catch (error) {
      setResult({ kind: 'error', text: describeSubmitError(error) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={panelStyles}>
      <p className={introStyles}>
        Verify by compiling locally: the backend downloads the selected solc build from
        binaries.soliditylang.org (cached under data/solc-cache — internet needed once per
        version), recompiles your input, and matches the runtime bytecode against this
        chain&apos;s own RPC. Works on private chains Sourcify does not cover; a metadata-hash
        difference alone still counts as a match and is reported.
      </p>
      <label className={fieldLabelStyles} htmlFor="compile-verify-version">
        Compiler version
      </label>
      <select
        id="compile-verify-version"
        className={versionSelectStyles}
        value={selectedVersion}
        disabled={versions === null || versions.length === 0}
        onChange={e => {
          setUserVersion(e.target.value);
          setResult(null);
        }}
      >
        <option value="">
          {versions === null
            ? 'Loading compiler versions…'
            : versions.length === 0
              ? 'No compiler versions available'
              : 'Select a version'}
        </option>
        {(versions ?? []).map(entry => (
          <option key={entry.longVersion} value={entry.longVersion ?? ''}>
            {entry.longVersion ?? entry.version}
            {entry.prerelease === true ? ' (prerelease)' : ''}
          </option>
        ))}
      </select>
      {derivedVersion !== '' && userVersion === '' && (
        <p className={hintStyles}>
          Preselected from the pasted build&apos;s compiler ({derivedVersion}) — change it if the
          on-chain code was built with another.
        </p>
      )}
      {listNote !== null && <p className={hintStyles}>{listNote}</p>}
      {listUnavailable !== null && (
        <p className={hintStyles}>{listUnavailable} — compile verification needs it.</p>
      )}
      <label className={fieldLabelStyles} htmlFor="compile-verify-input">
        Standard JSON input (a Hardhat build-info file works verbatim)
      </label>
      <textarea
        id="compile-verify-input"
        className={textareaStyles}
        value={jsonText}
        placeholder='{"language":"Solidity","sources":{…},"settings":{…}}'
        onChange={e => {
          setJsonText(e.target.value);
          setResult(null);
        }}
      />
      {jsonFeedback !== null && !jsonFeedback.ok && (
        <p className={feedbackBadStyles}>{jsonFeedback.reason}</p>
      )}
      {jsonFeedback?.ok === true && jsonFeedback.buildInfo && (
        <p className={hintStyles}>
          Hardhat build-info detected — its <code>input</code> object is submitted (the backend
          accepts the file either way).
        </p>
      )}
      <label className={fieldLabelStyles} htmlFor="compile-verify-contract">
        Contract name (optional)
      </label>
      <input
        id="compile-verify-contract"
        className={inputStyles}
        value={contractNameText}
        placeholder="e.g. Storage or contracts/Storage.sol:Storage — required when the input compiles to several contracts"
        onChange={e => setContractNameText(e.target.value)}
      />
      <div className={actionsRowStyles}>
        <button
          type="button"
          className={submitStyles}
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Compiling & comparing…' : 'Verify by compiling'}
        </button>
      </div>
      {submitting && (
        <p className={hintStyles}>
          Compiling runs on this explorer&apos;s server and can take a while the first time a
          version is used (the ~9 MB compiler build is downloaded once).
        </p>
      )}
      {result?.kind === 'verified' && result.tier === 'exact' && (
        <div role="status" className={resultVerifiedStyles} data-testid="compile-verify-result">
          Verified — recompiled bytecode matches the on-chain code exactly ({result.contractName},
          solc {result.compilerVersion}). Source saved and marked verified.
        </div>
      )}
      {result?.kind === 'verified' && result.tier === 'matches-metadata-only' && (
        <div role="status" className={resultVerifiedStyles} data-testid="compile-verify-result">
          Verified — bytecode matches after ignoring the metadata hash ({result.contractName}, solc{' '}
          {result.compilerVersion}). Source saved and marked verified. The auxdata differs:
          <div className={auxdataStyles}>on-chain: {truncateHex(result.onChainAuxdata)}</div>
          <div className={auxdataStyles}>recompiled: {truncateHex(result.compiledAuxdata)}</div>
        </div>
      )}
      {result?.kind === 'mismatch' && (
        <div role="alert" className={resultMismatchStyles} data-testid="compile-verify-result">
          {result.text} Check the compiler version, optimizer settings, and that the contract was
          not deployed with constructor arguments baked into runtime values (immutables).
        </div>
      )}
      {result?.kind === 'compile-error' && (
        <div role="alert" className={resultErrorListStyles} data-testid="compile-verify-result">
          {result.errors.length > 0
            ? result.errors.join('\n')
            : 'The compiler reported errors without detail.'}
        </div>
      )}
      {result?.kind === 'notice' && (
        <div role="status" className={resultNoticeStyles} data-testid="compile-verify-result">
          {result.text}
        </div>
      )}
      {result?.kind === 'error' && (
        <div role="alert" className={resultMismatchStyles} data-testid="compile-verify-result">
          {result.text}
        </div>
      )}
    </div>
  );
}
