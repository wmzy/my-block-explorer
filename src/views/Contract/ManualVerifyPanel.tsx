// In-page local-trust panel for contracts the remote verifiers cannot
// cover (anvil/hardhat/private deployments): paste the ABI (plus optional
// source and name) and this explorer stores it as a manual verification
// mark. The mark is a LOCAL TRUST ANNOTATION, not cryptographic
// verification — the copy, the badge title, and the response all say so.
// When a mark already exists the panel shows its state and offers the
// removal that reverts the contract to unverified on the next fetch.
import { useState } from 'react';
import { css } from '@linaria/core';
import { post, del, isBackendUnreachable } from '@/util/http';
import { ApiError } from '@/util/apiError';

// Mirrors the backend's contract (routes/verify.ts): the ABI must parse
// to a non-empty array. Validated live while typing so a doomed 400 never
// round-trips.
type AbiParseResult = { ok: true } | { ok: false; reason: string };

const parseAbiFeedback = (raw: string): AbiParseResult => {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'Paste the contract ABI (JSON array).' };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return { ok: false, reason: 'ABI must be a JSON array — an object or bare value is not one.' };
    }
    if (parsed.length === 0) {
      return { ok: false, reason: 'ABI array is empty — at least one entry is required.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Not valid JSON — the ABI must parse as a JSON array.' };
  }
};

// The endpoints' response shapes (see routes/verify.ts). Fields stay
// optional — the http layer answers unknown shapes with undefined, never
// with fabricated data.
type ManualVerifyResponse = {
  verified?: boolean;
  verificationSource?: string;
};

type ManualDeleteResponse = {
  success?: boolean;
};

// Infra failures get plain-word attribution: which hop was unreachable.
// 403 is the admin-token gate; 404 on DELETE means no mark existed (the
// refetch that follows lands on the honest state either way).
const describeSubmitError = (error: unknown, action: 'save' | 'remove'): string => {
  if (isBackendUnreachable(error)) {
    return 'The explorer API is unreachable — start the backend (or fix its address in ⚙ RPC settings) and try again.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'Requires admin token — set it via ⚙️ RPC → Admin token. The server must have ADMIN_TOKEN configured.';
  }
  if (error instanceof ApiError && error.status === 404 && action === 'remove') {
    return 'No manual mark was found — the contract may have been re-verified or the mark already removed.';
  }
  return error instanceof Error ? error.message : 'Request failed.';
};

const panelStyles = css`
  margin-bottom: 20px;
`;

const introStyles = css`
  margin: 0 0 12px 0;
  font-size: 13px;
  line-height: 1.5;
  color: #8a6d3b;
`;

const fieldLabelStyles = css`
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin: 10px 0 4px 0;
`;

const abiInputStyles = css`
  width: 100%;
  box-sizing: border-box;
  min-height: 120px;
  font-family: monospace;
  font-size: 12px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #ced4da;
  resize: vertical;
`;

const nameInputStyles = css`
  width: 100%;
  box-sizing: border-box;
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #ced4da;
`;

const sourceInputStyles = css`
  width: 100%;
  box-sizing: border-box;
  min-height: 80px;
  font-family: monospace;
  font-size: 12px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #ced4da;
  resize: vertical;
`;

const feedbackOkStyles = css`
  margin: 6px 0 0 0;
  font-size: 12px;
  color: #28a745;
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
  background: #6c757d;
  border: 1px solid #5a6268;
  color: white;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #5a6268;
  }

  &:disabled {
    background: #b6bec4;
    border-color: #b6bec4;
    cursor: not-allowed;
  }
`;

const removeStyles = css`
  padding: 8px 18px;
  font-size: 14px;
  border-radius: 6px;
  cursor: pointer;
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #f1b8bd;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

const resultNoticeStyles = css`
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
  background: #d4edda;
  border: 1px solid #c3e6cb;
  color: #155724;
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

const markedStateStyles = css`
  margin: 0 0 4px 0;
  font-size: 14px;
`;

export function ManualVerifyPanel({
  chainId,
  address,
  marked,
  onChanged,
}: {
  chainId: number;
  address: string;
  /** Whether the contract currently carries a manual verification mark. */
  marked: boolean;
  /** Refresh the page's contract source after a save or removal. */
  onChanged: () => void;
}) {
  const [abiText, setAbiText] = useState('');
  const [nameText, setNameText] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abiFeedback = parseAbiFeedback(abiText);
  const canSubmit = abiFeedback.ok && !submitting && !removing && address !== '';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const response = await post<ManualVerifyResponse>(
        `/api/chains/${chainId}/contracts/${address}/verify/manual`,
        {
          abi: abiText.trim(),
          ...(sourceText.trim() !== '' ? { sourceCode: sourceText } : {}),
          ...(nameText.trim() !== '' ? { name: nameText.trim() } : {}),
        },
      );
      if (response.verified === true && response.verificationSource === 'manual') {
        setNotice('Local trust mark saved — the source below now reflects it.');
        onChanged();
      } else {
        setError('The backend did not confirm the manual mark — refreshing to see the actual state.');
        onChanged();
      }
    } catch (err) {
      setError(describeSubmitError(err, 'save'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async () => {
    if (removing) return;
    setRemoving(true);
    setNotice(null);
    setError(null);
    try {
      await del<ManualDeleteResponse>(
        `/api/chains/${chainId}/contracts/${address}/verify/manual`,
      );
      setNotice('Local trust mark removed — the contract is unverified again unless a remote verifier covers it.');
      onChanged();
    } catch (err) {
      setError(describeSubmitError(err, 'remove'));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className={panelStyles}>
      {marked ? (
        <>
          <p className={introStyles}>
            This contract carries a <strong>manual verification mark</strong>: an ABI (and optional
            source) pasted locally and stored in this explorer&apos;s database. It is a local trust
            annotation, <strong>not cryptographic verification</strong> — nothing was matched
            against on-chain bytecode. The mark lives only in this explorer&apos;s database; it is
            not shared anywhere unless your server is. Remove it and re-paste to change what is
            stored.
          </p>
          <p className={markedStateStyles}>
            If Sourcify later verifies this contract, the next fetch supersedes the local mark with
            the cryptographic result.
          </p>
          <div className={actionsRowStyles}>
            <button
              type="button"
              className={removeStyles}
              disabled={removing}
              onClick={() => void handleRemove()}
            >
              {removing ? 'Removing…' : 'Remove local trust mark'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={introStyles}>
            For contracts the remote verifiers cannot cover (anvil, Hardhat, private deployments):
            paste the ABI to mark this contract as <strong>trusted locally</strong>. This is a local
            trust annotation, <strong>not cryptographic verification</strong> — nothing is matched
            against on-chain bytecode. It is stored in this explorer&apos;s database and not shared
            anywhere unless your server is.
          </p>
          <label className={fieldLabelStyles} htmlFor="manual-verify-abi">
            ABI (JSON array, required)
          </label>
          <textarea
            id="manual-verify-abi"
            className={abiInputStyles}
            value={abiText}
            placeholder='[{"type":"function","name":"...","inputs":[],"outputs":[]}]'
            spellCheck={false}
            onChange={e => {
              setAbiText(e.target.value);
              setNotice(null);
              setError(null);
            }}
          />
          {abiText.trim() !== '' &&
            (abiFeedback.ok ? (
              <p className={feedbackOkStyles}>ABI parses as a non-empty JSON array.</p>
            ) : (
              <p className={feedbackBadStyles}>{abiFeedback.reason}</p>
            ))}
          <label className={fieldLabelStyles} htmlFor="manual-verify-name">
            Contract name (optional)
          </label>
          <input
            id="manual-verify-name"
            className={nameInputStyles}
            type="text"
            value={nameText}
            placeholder="MyContract"
            onChange={e => setNameText(e.target.value)}
          />
          <label className={fieldLabelStyles} htmlFor="manual-verify-source">
            Source code (optional)
          </label>
          <textarea
            id="manual-verify-source"
            className={sourceInputStyles}
            value={sourceText}
            placeholder="contract MyContract { ... }"
            spellCheck={false}
            onChange={e => setSourceText(e.target.value)}
          />
          <div className={actionsRowStyles}>
            <button
              type="button"
              className={submitStyles}
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
            >
              {submitting ? 'Saving…' : 'Mark as trusted locally'}
            </button>
          </div>
        </>
      )}
      {notice && (
        <div role="status" className={resultNoticeStyles}>
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className={resultErrorStyles}>
          {error}
        </div>
      )}
    </div>
  );
}
