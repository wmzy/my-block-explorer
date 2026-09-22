// In-page Sourcify verification panel for unverified contracts: pick the
// build artifacts (metadata.json plus the .sol sources it references),
// submit them through the explorer backend — which proxies the POST, since
// the browser cannot cross-origin POST sourcify.dev — and reflect the
// outcome honestly: success refreshes the page's contract source, Sourcify
// refusals render their own words, and infrastructure failures say who
// was unreachable. The external widget deep link in the info card remains
// the alternative path.
import { useState } from 'react';
import { css } from '@linaria/core';
import { post, isBackendUnreachable } from '@/util/http';
import { ApiError } from '@/util/apiError';

// Mirrors the backend's bundle caps (ContractVerifyService) so the page
// refuses locally instead of round-tripping a doomed 400.
const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

type PickedFile = { name: string; content: string; bytes: number };

type PanelResult =
  | { kind: 'verified'; status: string }
  | { kind: 'notice'; text: string }
  | { kind: 'error'; text: string };

// The endpoint's response union (see routes/verify.ts): success carries
// the sourcify match status; domain refusals carry kind + sourcify's
// message. Fields stay optional — the http layer answers unknown shapes
// with undefined, never with fabricated data.
type VerifyResponse = {
  verified?: boolean;
  status?: string;
  kind?: string;
  message?: string;
};

const panelStyles = css`
  margin-bottom: 20px;
`;

const introStyles = css`
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #666;
`;

const fileRowStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const fileInputStyles = css`
  font-size: 13px;
  /* Native file inputs have an intrinsic width; cap it so the picker never
     stretches past the card on a phone. */
  max-width: 100%;
`;

const chipsStyles = css`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
`;

const chipStyles = css`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: #f8f9fa;
  border: 1px solid #e1e5e9;
  border-radius: 4px;
  font-size: 13px;
  font-family:
    'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  color: #1a1a1a;
  width: fit-content;
`;

const chipNameStyles = css`
  word-break: break-all;
`;

const chipRemoveStyles = css`
  border: none;
  background: none;
  padding: 0 2px;
  color: #999;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: #721c24;
  }
`;

const hintStyles = css`
  margin: 8px 0 0 0;
  font-size: 13px;
  color: #8a6d3b;
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

const resultNoticeStyles = css`
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
  background: #fff8e6;
  border: 1px solid #f0a500;
  color: #8a6d3b;
`;

const resultErrorStyles = css`
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
  word-break: break-word;
`;

// Infra failures get plain-word attribution: which hop was unreachable.
// 502 bodies already say the Sourcify round trip failed; 0 means the
// explorer API itself never answered; 403 is the admin-token gate.
const describeSubmitError = (error: unknown): string => {
  if (isBackendUnreachable(error)) {
    return 'The explorer API is unreachable — start the backend (or fix its address in ⚙ RPC settings) and try again.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'Requires admin token — set it via ⚙️ RPC → Admin token. The server must have ADMIN_TOKEN configured.';
  }
  if (error instanceof ApiError && error.status === 502) {
    return `${error.message} Try again in a moment.`;
  }
  return error instanceof Error ? error.message : 'Verification request failed.';
};

const formatBytes = (bytes: number): string =>
  bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

export function SourcifyVerifyPanel({
  chainId,
  address,
  onVerified,
}: {
  chainId: number;
  address: string;
  onVerified: () => void;
}) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PanelResult | null>(null);

  const hasMetadata = files.some(file => file.name === 'metadata.json');
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const tooMany = files.length > MAX_FILES;
  const tooBig = totalBytes > MAX_TOTAL_BYTES;
  const canSubmit = hasMetadata && !tooMany && !tooBig && !reading && !submitting && address !== '';

  const handleFilesPicked = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setResult(null);
    setReading(true);
    try {
      // Later picks of the same name replace the earlier entry — the
      // bundle is keyed by file name, so the newest content wins.
      const picked = new Map<string, PickedFile>();
      for (const file of Array.from(fileList)) {
        picked.set(file.name, {
          name: file.name,
          content: await file.text(),
          bytes: file.size,
        });
      }
      setFiles(prev => {
        const merged = new Map(prev.map(file => [file.name, file]));
        for (const file of picked.values()) merged.set(file.name, file);
        return [...merged.values()];
      });
    } finally {
      setReading(false);
    }
  };

  const removeFile = (name: string) => {
    setResult(null);
    setFiles(prev => prev.filter(file => file.name !== name));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const payload: Record<string, string> = {};
      for (const file of files) payload[file.name] = file.content;
      const response = await post<VerifyResponse>(
        `/api/chains/${chainId}/contracts/${address}/verify`,
        { files: payload },
      );
      if (response.verified === true) {
        setResult({ kind: 'verified', status: response.status ?? 'unknown' });
        onVerified();
      } else if (response.kind === 'unsupported_chain') {
        setResult({
          kind: 'notice',
          text: `Sourcify does not support this chain: ${response.message ?? 'chain not supported'}`,
        });
      } else {
        setResult({
          kind: 'error',
          text: response.message ?? 'Sourcify refused the verification.',
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
        Pick the contract&apos;s metadata.json (from your build&apos;s artifacts) and the Solidity
        source files it references — the same bundle Sourcify&apos;s own verifier takes. The
        submission goes through this explorer&apos;s backend and refreshes the source here on
        success.
      </p>
      <div className={fileRowStyles}>
        <input
          className={fileInputStyles}
          type="file"
          multiple
          accept=".json,.sol"
          aria-label="Verification files"
          onChange={e => {
            void handleFilesPicked(e.target.files);
            // Allow re-picking the same file (e.g. after an edit) — the
            // change event only fires when the selection differs.
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <div className={chipsStyles}>
          {files.map(file => (
            <span key={file.name} className={chipStyles} data-testid="verify-file-chip">
              <span className={chipNameStyles}>{file.name}</span>
              <span>({formatBytes(file.bytes)})</span>
              <button
                type="button"
                className={chipRemoveStyles}
                aria-label={`Remove ${file.name}`}
                onClick={() => removeFile(file.name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {reading && <p className={hintStyles}>Reading files…</p>}
      {files.length > 0 && !hasMetadata && (
        <p className={hintStyles}>
          metadata.json is required — add it (and the sources it references) before submitting.
        </p>
      )}
      {tooMany && (
        <p className={hintStyles}>Too many files — the limit is {MAX_FILES}.</p>
      )}
      {tooBig && (
        <p className={hintStyles}>
          Selected files total {formatBytes(totalBytes)} — the limit is 2 MB.
        </p>
      )}
      <div className={actionsRowStyles}>
        <button
          type="button"
          className={submitStyles}
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Verifying…' : 'Verify via Sourcify'}
        </button>
      </div>
      {result?.kind === 'verified' && (
        <div role="status" className={resultVerifiedStyles} data-testid="verify-result">
          Verified ({result.status}) — source refreshed
        </div>
      )}
      {result?.kind === 'notice' && (
        <div role="status" className={resultNoticeStyles} data-testid="verify-result">
          {result.text}
        </div>
      )}
      {result?.kind === 'error' && (
        <div role="alert" className={resultErrorStyles} data-testid="verify-result">
          {result.text}
        </div>
      )}
    </div>
  );
}
