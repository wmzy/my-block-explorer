import { css, cx } from '@linaria/core';
import { useEffect, useRef, useState } from 'react';

import { Card, CardHeader, CardTitle } from './Card';
import { ErrorState } from './ErrorState';

// One raw-RPC payload section of the Raw JSON card. `load` receives the
// section's abort signal so a collapse mid-flight cancels the request;
// `note` renders an honest placeholder instead of fetching (e.g. a pending
// transaction's "no receipt yet" — a stated absence, not an error).
export type RawJsonFetcher = {
  /** Section heading, e.g. "Transaction". */
  label: string;
  /** Loads the raw payload for this section. */
  load: (signal?: AbortSignal) => Promise<unknown>;
  /** When set, the section renders this note instead of ever fetching. */
  note?: string;
};

type RawJsonProps = {
  /** Card heading, e.g. "Raw JSON". */
  title: string;
  fetchers: RawJsonFetcher[];
};

// The clickable header row: full-width toggle with the Collapsible card's
// affordances (role=button, keyboard, rotating chevron). Built on Card
// primitives instead of the Collapsible component because the fetches must
// fire on the FIRST expand only — semantics Collapsible's internal state
// cannot signal outward (same reason CallTraceCard rolls its own).
const headerToggleStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-3);
  width: 100%;
  cursor: pointer;
  user-select: none;
`;

const chevronStyle = css`
  width: 20px;
  height: 20px;
  color: var(--haze-color-text-muted);
  transition: transform 200ms ease;
  flex-shrink: 0;
`;

const chevronExpandedStyle = css`
  transform: rotate(180deg);
`;

// Sections stay MOUNTED while collapsed (hidden, not unmounted): their
// settled payloads survive collapse/expand as a cache, while the hidden
// card pays for nothing — the per-section fetch effect is gated on the
// active flag and aborts in-flight requests when it flips false.
const contentStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-5);
  padding: var(--haze-space-6);
  border-top: 1px solid var(--haze-color-border);
`;

const contentCollapsedStyle = css`
  display: none;
`;

const sectionStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
  min-width: 0;
`;

const sectionHeaderStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-3);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
`;

// Plain pre with internal scrolling: long JSON lines (unbroken hex blobs
// inside quoted strings) scroll inside the box instead of stretching the
// page. Dark syntax highlighting is deliberately out of scope.
const preStyle = css`
  margin: 0;
  max-height: 420px;
  overflow: auto;
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  background: var(--haze-color-bg-subtle);
  padding: var(--haze-space-3);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  line-height: var(--haze-leading-relaxed);
  white-space: pre;
`;

const noteStyle = css`
  margin: 0;
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
`;

const statusStyle = css`
  margin: 0;
  color: var(--haze-color-text-muted);
`;

const copyButtonStyle = css`
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  background: var(--haze-color-bg);
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-xs);
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

// JSON.stringify(undefined) is undefined (not a string) and BigInt values
// make it throw; both collapse to a rendering instead of a crash.
const prettyPrint = (data: unknown): string => {
  try {
    return JSON.stringify(data, null, 2) ?? 'null';
  } catch {
    return String(data);
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : 'The request failed.';

// Per-section copy button with the codebase's label-swap feedback pattern
// (SourceCodeViewer/CustomAbiPanel): the button itself reports success or
// failure — the honest outcome of the clipboard call, never a guess.
function CopyButton({ text }: { text: string }) {
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
    <button type="button" className={copyButtonStyle} onClick={() => void handleCopy()}>
      {result === 'ok' ? 'Copied ✓' : result === 'fail' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

type SectionPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; text: string }
  | { kind: 'error'; message: string };

type RawJsonSectionProps = {
  label: string;
  load: (signal?: AbortSignal) => Promise<unknown>;
  note: string | undefined;
  /** True while the card is expanded: sections only fetch while visible. */
  active: boolean;
};

// One fetch-on-expand section: loading / payload / retryable error, or the
// honest note placeholder. A section that settled once never refetches on
// later expands (the settled payload is the cache); a request aborted by
// collapsing never settled, so the next expand refetches it.
function RawJsonSection({ label, load, note, active }: RawJsonSectionProps) {
  const [phase, setPhase] = useState<SectionPhase>({ kind: 'idle' });
  // Retry nonce: each click re-arms exactly one fetch attempt.
  const [attempts, setAttempts] = useState(0);
  // Latch: a settled payload survives collapse/expand untouched.
  const settledRef = useRef(false);
  // Latest load without retriggering the effect on caller identity churn
  // (consumers rebuild fetcher arrays on unrelated re-renders).
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!active || note !== undefined || settledRef.current) return;
    const controller = new AbortController();
    setPhase({ kind: 'loading' });
    loadRef.current(controller.signal).then(
      data => {
        if (controller.signal.aborted) return;
        settledRef.current = true;
        setPhase({ kind: 'loaded', text: prettyPrint(data) });
      },
      error => {
        if (controller.signal.aborted) return;
        setPhase({ kind: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      controller.abort();
      // Collapsed or unmounted mid-flight: nothing settled, so nothing is
      // cached — back to idle so a later expand refetches honestly.
      setPhase(prev => (prev.kind === 'loading' ? { kind: 'idle' } : prev));
    };
  }, [active, note, attempts]);

  return (
    <div className={sectionStyle}>
      <div className={sectionHeaderStyle}>
        <span>{label}</span>
        {phase.kind === 'loaded' && <CopyButton text={phase.text} />}
      </div>
      {note !== undefined ? (
        <p className={noteStyle} data-testid="raw-json-note">
          {note}
        </p>
      ) : phase.kind === 'loading' ? (
        <p className={statusStyle} data-testid="raw-json-loading">
          Fetching raw data…
        </p>
      ) : phase.kind === 'error' ? (
        <ErrorState
          message={phase.message}
          onRetry={() => setAttempts(count => count + 1)}
          retryLabel={`Retry ${label}`}
        />
      ) : phase.kind === 'loaded' ? (
        <pre className={preStyle} data-testid="raw-json-payload">
          {phase.text}
        </pre>
      ) : (
        <p className={statusStyle}>Not fetched yet.</p>
      )}
    </div>
  );
}

// "Raw JSON" card: a collapsed-by-default appendix for the verbatim RPC
// payloads behind a detail page (browser-fetched ephemeral data — the
// data-separation rule). Sections fetch on the first expand only and cache
// across collapse/expand; each failure degrades to its own retryable
// error, never affecting siblings or the page.
export function RawJsonCard({ title, fetchers }: RawJsonProps) {
  const [expanded, setExpanded] = useState(false);

  const handleToggle = () => {
    setExpanded(prev => !prev);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggle();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          className={headerToggleStyle}
          data-testid="raw-json-header"
        >
          <CardTitle>{title}</CardTitle>
          <svg
            className={cx(chevronStyle, expanded && chevronExpandedStyle)}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </CardHeader>
      <div className={cx(contentStyle, !expanded && contentCollapsedStyle)} aria-hidden={!expanded}>
        {fetchers.map((fetcher, index) => (
          <RawJsonSection
            key={`${index}-${fetcher.label}-${fetcher.note ?? ''}`}
            label={fetcher.label}
            load={fetcher.load}
            note={fetcher.note}
            active={expanded}
          />
        ))}
      </div>
    </Card>
  );
}

export default RawJsonCard;
