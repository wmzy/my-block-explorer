// /signatures — the signature lookup tool. One input resolves a 4-byte
// function selector or a 32-byte event topic0 against the openchain
// signature registry through the backend's DuckDB-backed cache
// (GET /api/signatures). Signatures are chain-agnostic, so the page is
// deliberately not chain-scoped. The query rides the URL as ?q= (the
// Contracts directory settle-guard/debounce pattern): deep links —
// including the raw-log table's "Look up topic0" chips — land pre-filled
// and auto-search, and every outcome state is a shareable link. No search
// history is recorded (unlike the global search): lookups here are tool
// queries, not navigation.
//
// Honesty contract: openchain is a public submissions database — an
// honest miss ("No match in the openchain registry") is not proof that no
// signature exists. Name fragments are NOT resolvable by the backend
// (exact-selector lookups only), so a classified name degrades to an
// explicit explanation instead of a silently wrong query.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { css } from '@linaria/core';
import { navigate } from '@native-router/core';
import { useSearch, useSetSearch, useRouter } from '@native-router/react';
import { z } from 'zod';
import { Input } from 'haze-ui';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BackendOfflineState, EmptyState, ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { useServiceDiscovery } from '@/hooks/ServiceDiscoveryContext';
import { useSignatureLookup } from '@/services/signatures';
import type { ResolvedSignatures, SignatureLookup } from '@/services/signatures';
import { isBackendUnreachable } from '@/util/http';
import { readRememberedChainId } from '@/views/Home/Landing';

// ---------------------------------------------------------------------------
// Input classification (pure, exported for tests)
//
// Exactly three well-formed kinds, decided by strict shape:
// - selector: 0x + exactly 8 hex characters
// - topic0:   0x + exactly 64 hex characters
// - name:     a signature-syntax fragment (letters, digits, _ [ ] , ( ))
// Anything else is invalid with actionable guidance. Hex is
// case-insensitive and normalized to lowercase; surrounding whitespace is
// trimmed. Redundant-zero forms (0x0000…ABCD) are deliberately INVALID:
// unless the length is exactly 8 or 64, padding or truncating changes
// which value the string names, so ambiguous lengths are rejected with
// guidance instead of guessed at. A bare hex word (no 0x prefix) is
// likewise invalid with a prefix hint — silently treating "a9059cbb" as
// a name would query the wrong database.
// ---------------------------------------------------------------------------

export type SignatureQueryClassification =
  | { kind: 'selector'; normalized: string }
  | { kind: 'topic0'; normalized: string }
  | { kind: 'name'; normalized: string }
  | { kind: 'invalid'; reason: string };

const HEX_BODY_RE = /^[0-9a-f]+$/i;
const NAME_FRAGMENT_RE = /^[A-Za-z0-9_[\],()]+$/;

/** Classify a raw lookup query (see the block above for the exact rules). */
export function classifySignatureQuery(raw: string): SignatureQueryClassification {
  const query = raw.trim();
  if (query === '') {
    return {
      kind: 'invalid',
      reason:
        'Enter a 4-byte function selector (0x + 8 hex characters) or a 32-byte event topic0 (0x + 64 hex characters).',
    };
  }
  if (query.slice(0, 2).toLowerCase() === '0x') {
    const body = query.slice(2);
    if (!HEX_BODY_RE.test(body)) {
      return {
        kind: 'invalid',
        reason: `"${query}" has the 0x prefix but contains characters that are not hexadecimal.`,
      };
    }
    if (body.length === 8) {
      return { kind: 'selector', normalized: `0x${body.toLowerCase()}` };
    }
    if (body.length === 64) {
      return { kind: 'topic0', normalized: `0x${body.toLowerCase()}` };
    }
    return {
      kind: 'invalid',
      reason:
        `"${query}" is ${body.length} hex characters after 0x — a function selector is exactly 8 and an event topic0 exactly 64. `
        + 'Lengths are strict: zero-padding or truncating a value would name a different selector, so enter the exact-width form.',
    };
  }
  if (HEX_BODY_RE.test(query)) {
    return {
      kind: 'invalid',
      reason:
        `"${query}" looks like a hex value without its 0x prefix — add it (and mind the exact 8-or-64 length) to look the value up.`,
    };
  }
  if (NAME_FRAGMENT_RE.test(query)) {
    return { kind: 'name', normalized: query };
  }
  return {
    kind: 'invalid',
    reason:
      `"${query}" is neither a 0x-prefixed selector/topic0 nor signature syntax (letters, digits, _ [ ] , ( )).`,
  };
}

// Search params: ?q= is the lookup query (any string is a legal query —
// classification renders guidance instead of rejecting the URL). Exported
// for the page tests.
export const searchSchema = z.object({ q: z.string().optional() });

// Debounce: the URL (?q=) only moves once typing pauses, so the query
// layer is not re-keyed per keystroke (Contracts directory pattern).
const SEARCH_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const toolbar = css`
  display: flex;
  gap: var(--haze-space-3);
  align-items: flex-start;
  flex-wrap: wrap;
  margin-bottom: var(--haze-space-3);
`;

const queryBox = css`
  flex: 1;
  min-width: 260px;
`;

const sourceNote = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  margin: 0 0 var(--haze-space-5);
`;

const guidanceCard = css`
  background-color: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  padding: var(--haze-space-4);
  font-size: var(--haze-text-sm);
  margin: 0;
`;

const idleHint = css`
  color: var(--haze-color-text-secondary);
  font-size: var(--haze-text-sm);
  margin: 0;
`;

const resultsSection = css`
  margin-bottom: var(--haze-space-5);
`;

const sectionTitle = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  margin: 0 0 var(--haze-space-3);
`;

const sectionNote = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  margin: 0;
`;

const signatureList = css`
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
`;

const signatureRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  padding: var(--haze-space-3) var(--haze-space-4);

  & + & {
    border-top: 1px solid var(--haze-color-border);
  }
`;

const signatureText = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  word-break: break-all;
  flex: 1;
`;

const copyButton = css`
  background: none;
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  color: var(--haze-color-text-secondary);
  cursor: pointer;
  font-size: var(--haze-text-xs);
  padding: 2px var(--haze-space-2);
  white-space: nowrap;

  &:hover {
    color: var(--haze-color-text);
    border-color: var(--haze-color-text-muted);
  }
`;

const unavailableCard = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
  border: 1px solid var(--haze-color-warning);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-warning-subtle);
  padding: var(--haze-space-4);
`;

const unavailableText = css`
  flex: 1;
  min-width: 220px;
  margin: 0;
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
`;

const emptyNote = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  margin: var(--haze-space-2) 0 0;
`;

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

// Per-row copy with the codebase's label-swap feedback pattern
// (EventTable CopyButton): the button reports the honest outcome of the
// clipboard call, never a guess.
function SignatureCopyButton({ text }: { text: string }) {
  const [result, setResult] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setResult('ok');
    } catch {
      setResult('fail');
    }
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setResult('idle'), 2000);
  };

  return (
    <button type="button" className={copyButton} onClick={() => void handleCopy()}>
      {result === 'ok' ? 'Copied ✓' : result === 'fail' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

// The found-candidates rows for one side. A separate component so the
// found branch's narrowed outcome stays narrowed (the hook's found status
// already carries the precise type).
function FoundSignatureRows({ outcome }: { outcome: ResolvedSignatures }) {
  return (
    <ul className={signatureList}>
      {outcome.signatures.map(signature => (
        <li key={signature} className={signatureRow}>
          <code className={signatureText}>{signature}</code>
          <Badge variant="info" size="sm">
            {outcome.source}
          </Badge>
          <SignatureCopyButton text={signature} />
        </li>
      ))}
    </ul>
  );
}

type LookupSectionProps = {
  title: string;
  /** Whether the current query resolves on this side (selector→Functions, topic0→Events). */
  applicable: boolean;
  /** Honest note for the side the current query cannot populate. */
  inapplicableNote: string;
  lookup: SignatureLookup & { refetch: () => void | Promise<unknown> };
  onRetryConnection: () => void;
  retryConnectionPending: boolean;
};

// One results section. Only the applicable side ever consults the lookup;
// the other stays explicit about WHY it is empty instead of rendering a
// misleading "no match".
function LookupSection({
  title,
  applicable,
  inapplicableNote,
  lookup,
  onRetryConnection,
  retryConnectionPending,
}: LookupSectionProps) {
  return (
    <section className={resultsSection} aria-label={`${title} signatures`}>
      <h2 className={sectionTitle}>{title}</h2>
      {!applicable ? (
        <p className={sectionNote}>{inapplicableNote}</p>
      ) : lookup.status === 'loading' ? (
        <TableSkeleton rows={2} cols={2} />
      ) : lookup.status === 'error' ? (
        isBackendUnreachable(lookup.error) ? (
          <BackendOfflineState
            onRetryConnection={onRetryConnection}
            retryConnectionPending={retryConnectionPending}
          />
        ) : (
          <ErrorState
            message={
              lookup.error instanceof Error ? lookup.error.message : 'Signature lookup failed'
            }
            onRetry={() => void lookup.refetch()}
          />
        )
      ) : lookup.status === 'unavailable' ? (
        <div className={unavailableCard} role="status">
          <p className={unavailableText}>
            Lookup unavailable right now — the backend could not get an answer from the openchain
            registry. This is a temporary failure, not a “no match” result.
          </p>
          <Button variant="outline" size="sm" onClick={() => void lookup.refetch()}>
            Retry lookup
          </Button>
        </div>
      ) : lookup.status === 'miss' ? (
        <EmptyState message="No match in the openchain registry.">
          <p className={emptyNote}>
            The registry is a public submissions database — a miss here is not proof that no
            signature exists.
          </p>
        </EmptyState>
      ) : lookup.status === 'found' ? (
        <FoundSignatureRows outcome={lookup.outcome} />
      ) : (
        // idle is statically reachable through the shared lookup union but
        // never reaches a rendered section (sections only mount once a
        // selector is classified); it renders nothing rather than guessing.
        null
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function SignaturesView() {
  const router = useRouter();
  const setSearch = useSetSearch(searchSchema);
  const { q: qParam } = useSearch(searchSchema);

  // Not chain-scoped, but the topbar still is (Sql console pattern): the
  // remembered chain — never a hard-coded one — provides that context.
  const navChainId = readRememberedChainId() ?? 1;
  const handleNavChainChange = (chainId: number) => {
    navigate(router, `/chain/${chainId}`).catch(() => undefined);
  };

  // The input starts from the deep-linked ?q= and then leads the URL: the
  // debounced write (or Enter) replaces the URL entry so typing does not
  // spam history (Contracts directory pattern).
  const [qInput, setQInput] = useState(() => qParam ?? '');
  // The ?q= value this view itself last pushed — distinguishes the URL
  // write the debounce causes (input must keep leading) from an external
  // URL change (deep link, back/forward — input must follow).
  const lastPushedQRef = useRef<string | null>(null);

  const commitQ = useCallback(
    (next: string) => {
      if ((qParam ?? '') === next) return;
      lastPushedQRef.current = next;
      void setSearch(prev => {
        const { q: _oldQ, ...rest } = prev;
        return next === '' ? rest : { ...rest, q: next };
      }, { replace: true });
    },
    [qParam, setSearch],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      commitQ(qInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput, commitQ]);

  // External ?q= change (deep link, back/forward): sync the input unless
  // the URL carries exactly what this view just pushed.
  useEffect(() => {
    const urlQ = qParam ?? '';
    if (lastPushedQRef.current === urlQ) return;
    setQInput(urlQ);
  }, [qParam]);

  // Classification drives everything below from the SETTLED URL value, so
  // a deep link auto-searches the moment the page opens.
  const trimmedQ = (qParam ?? '').trim();
  const classification = trimmedQ === '' ? null : classifySignatureQuery(trimmedQ);
  const lookupSelector =
    classification !== null && (classification.kind === 'selector' || classification.kind === 'topic0')
      ? classification.normalized
      : undefined;
  const lookup = useSignatureLookup(lookupSelector);

  // The submit affordance reflects what is TYPED (immediate feedback);
  // the results reflect the settled ?q= (debounce depth between them).
  const inputClassification = classifySignatureQuery(qInput);
  const canSubmit =
    inputClassification.kind === 'selector' || inputClassification.kind === 'topic0';

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitQ(qInput.trim());
    }
  };

  // Backend-offline recovery (Contract view pattern): a plain Retry would
  // fast-fail while the API base is unset, so the offline state re-runs
  // service discovery first and re-asks the lookup once a service is back.
  const { reconnect } = useServiceDiscovery();
  const [retryingConnection, setRetryingConnection] = useState(false);
  const handleRetryConnection = async () => {
    if (retryingConnection) return;
    setRetryingConnection(true);
    try {
      const service = await reconnect();
      if (service) void lookup.refetch();
    } finally {
      setRetryingConnection(false);
    }
  };

  return (
    <>
      <TopNavigation currentChainId={navChainId} onChainChange={handleNavChainChange} />
      <PageContainer>
        <PageHeader
          title="Signatures"
          chainInfo="Function selectors and event topic0 hashes resolved against the openchain
            signature registry through this explorer's backend cache. Not chain-scoped — a
            selector hashes the same canonical text on every chain."
        />

        <div className={toolbar}>
          <div className={queryBox}>
            <Input
              placeholder="Function selector (0x + 8 hex) or event topic0 (0x + 64 hex)"
              value={qInput}
              onChange={e => setQInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              spellCheck={false}
              aria-label="Signature lookup query"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => commitQ(qInput.trim())}
            disabled={!canSubmit}
          >
            Look up
          </Button>
        </div>

        <p className={sourceNote}>
          Sourced from the openchain signature registry (public submissions — a miss is not proof
          no signature exists). Lookups are not recorded in search history.
        </p>

        {classification === null && (
          <p className={idleHint}>
            Enter a function selector or an event topic0 to resolve it. The events table’s
            “Look up topic0” chips link here pre-filled.
          </p>
        )}

        {classification?.kind === 'invalid' && (
          <p className={guidanceCard}>{classification.reason}</p>
        )}

        {classification?.kind === 'name' && (
          <p className={guidanceCard}>
            Name search needs an exact signature — enter a 4-byte selector or 32-byte topic0.
            This explorer’s backend resolves exact selectors only; it cannot search the registry
            by name fragment.
          </p>
        )}

        {classification !== null && lookupSelector !== undefined && (
          <>
            <LookupSection
              title="Functions"
              applicable={classification.kind === 'selector'}
              inapplicableNote="This query is an event topic0 — function selectors (0x + 8 hex characters) resolve here."
              lookup={lookup}
              onRetryConnection={() => void handleRetryConnection()}
              retryConnectionPending={retryingConnection}
            />
            <LookupSection
              title="Events"
              applicable={classification.kind === 'topic0'}
              inapplicableNote="This query is a function selector — event topic0 hashes (0x + 64 hex characters) resolve here."
              lookup={lookup}
              onRetryConnection={() => void handleRetryConnection()}
              retryConnectionPending={retryingConnection}
            />
          </>
        )}
      </PageContainer>
    </>
  );
}
