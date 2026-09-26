import { css } from '@linaria/core';
import { TypedLink } from '@native-router/react';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { Card, CardContent, CardTitle } from '@/components/ui/Card';

// Static troubleshooting page: the accumulated provider- and setup-quirk
// knowledge turned into honest, actionable copy. Pure content — no data
// fetching, no loader, no chain scope (the failure modes describe RPC
// providers and run modes, which are the same on every chain). Copy is
// aligned with docs/INSTALLATION.md (three run modes, npx command),
// docs/API.md (/api/health fields) and the honest-coverage vocabulary the
// CoverageBadge chips carry.

// The command the setup ecosystem agrees on (SetupRequiredScreen's npx tab
// and the GettingStarted card show the same string).
const NPX_COMMAND = 'npx my-block-explorer --port 8201';

// One entry per RPC provider quirk: the symptom the reader arrived with,
// why it happens, what this explorer already does about it, and the fix.
type QuirkEntry = {
  readonly symptom: string;
  readonly explanation: string;
};

const RPC_QUIRKS: readonly QuirkEntry[] = [
  {
    symptom: '"block range too large" / "results exceed limit"',
    explanation:
      'Public log endpoints cap how many blocks one eth_getLogs call may span, and every provider draws the line differently. This explorer already mitigates: scans chunk adaptively and remember each provider\u2019s ceiling. When a scan still cannot finish inside its budget, the page reports partial coverage with its badge instead of presenting the short list as if it were complete \u2014 widen the window or use a keyed endpoint to go further.',
  },
  {
    symptom: '"historical state \u2026 not available" (also "missing trie node", "pruned")',
    explanation:
      'Non-archive nodes discard old state, so balance-history charts and address deep scans \u2014 which read balances at past blocks \u2014 fail once they reach the pruned range. Fix: point the chain at an archive-mode RPC (\u2699 RPC settings; most providers offer archive endpoints on a free or paid tier).',
  },
  {
    symptom: 'Pending page shows an unsupported card',
    explanation:
      'That card is the honest answer, not a bug: most public RPCs keep their transaction pool private and simply do not expose the txpool endpoints. To see pending transactions, use a node you control (or a provider tier that serves txpool content) as the chain\u2019s RPC.',
  },
  {
    symptom: 'Call Trace / Internal Txns render as unavailable',
    explanation:
      'Traces need the debug_traceTransaction method, which most public RPCs disable. The page degrades honestly \u2014 the transaction itself still renders \u2014 and lights up once the chain\u2019s RPC serves debug methods (a self-run node with the debug API enabled, or a provider tier that includes it).',
  },
  {
    symptom: 'HTTP 429 responses',
    explanation:
      'Rate limiting: shared free endpoints throttle bursts, and 429 bodies carry a Retry-After the explorer honors by backing off. Occasional 429s are normal on public endpoints; constant ones mean the endpoint is saturated for your usage \u2014 register a provider API key (\u2699 RPC settings) or use your own node.',
  },
];

// /api/health fields, as returned by the backend (src/api-app.ts). The
// meanings are sourced from docs/API.md and the deployment model.
type HealthField = {
  readonly field: string;
  readonly meaning: string;
};

const HEALTH_FIELDS: readonly HealthField[] = [
  {
    field: 'status',
    meaning:
      '"ok" means the process answered at all \u2014 it says nothing about RPC reachability or data coverage.',
  },
  {
    field: 'adminTokenConfigured',
    meaning:
      'Whether the server has ADMIN_TOKEN set. true: admin-gated writes require the x-admin-token header (fill it in \u2699 RPC \u2192 Admin token). false: zero-config local mode \u2014 those writes pass through.',
  },
  {
    field: 'debugApiEnabled',
    meaning:
      'Whether the raw-SQL debug API is mounted (ENABLE_DEBUG_API=1). Expected false; the server refuses to start with it enabled on a public bind.',
  },
  {
    field: 'version',
    meaning:
      'The backend\u2019s version. Compare it against the frontend\u2019s: a hosted demo frontend and an npx-started backend follow independent release lines and can be out of sync \u2014 build both from the same source if they disagree.',
  },
  {
    field: 'timestamp',
    meaning: 'The server\u2019s clock at answer time \u2014 a quick skew check for log correlation.',
  },
];

const sectionCardStyle = css`
  margin-bottom: var(--haze-space-6);
`;

const paragraphStyle = css`
  margin: var(--haze-space-3) 0 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);

  &:first-of-type {
    margin-top: 0;
  }
`;

const commandStyle = css`
  display: block;
  margin: var(--haze-space-3) 0 0;
  padding: var(--haze-space-2) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  background: var(--haze-color-bg-muted);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  word-break: break-all;
`;

const quirkListStyle = css`
  list-style: none;
  margin: var(--haze-space-5) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-5);
`;

const quirkItemStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
`;

const quirkSymptomStyle = css`
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  line-height: var(--haze-leading-relaxed);
`;

const quirkExplanationStyle = css`
  margin: 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);
`;

const healthListStyle = css`
  margin: var(--haze-space-5) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-3);
`;

const healthItemStyle = css`
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: var(--haze-space-3);
  align-items: start;

  /* 375px-clean: the field name stacks above its meaning, the same single
     column the legend's level rows collapse to. */
  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--haze-space-1);
  }
`;

const healthFieldStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  word-break: break-all;
`;

const healthMeaningStyle = css`
  margin: 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);
`;

const linkStyle = css`
  color: var(--haze-color-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const inlineMonoStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
`;

export default function Troubleshooting() {
  return (
    <PageContainer narrow>
      <PageHeader
        title="Troubleshooting"
        chainInfo="Common failures, what they actually mean, and what to do about them"
      />

      <Card className={sectionCardStyle}>
        <CardContent>
          <CardTitle as="h2">The &ldquo;Backend not found&rdquo; banner</CardTitle>
          <p className={paragraphStyle}>
            The banner means the frontend probed <span className={inlineMonoStyle}>localhost:8201&ndash;8205</span> for
            a local API server and none answered. Nothing is broken: RPC-backed pages (blocks, transactions, live
            balances, charts) keep working straight from the chain&rsquo;s RPC in your browser. What stays gated is
            everything that lives in the backend&rsquo;s DuckDB &mdash; search, contract caches, event indexing,
            labels.
          </p>
          <p className={paragraphStyle}>
            The same frontend supports three run modes &mdash; pick one per visit, nothing is locked in:
          </p>
          <ul className={quirkListStyle}>
            <li className={quirkItemStyle}>
              <span className={quirkSymptomStyle}>RPC-only &mdash; no backend</span>
              <p className={quirkExplanationStyle}>
                Browse live data with nothing installed and nothing stored. The banner is dismissible and the
                RPC-backed pages keep working around it.
              </p>
            </li>
            <li className={quirkItemStyle}>
              <span className={quirkSymptomStyle}>Local backend &mdash; full feature set</span>
              <p className={quirkExplanationStyle}>
                Start the backend and it is auto-discovered on any of the probed ports:
                <code className={commandStyle}>{NPX_COMMAND}</code>
                The banner&rsquo;s <em>Open setup</em> panel carries this command, a manual backend URL field (for
                shared deployments) and a retry that keeps re-probing.
              </p>
            </li>
            <li className={quirkItemStyle}>
              <span className={quirkSymptomStyle}>Shared deployment &mdash; one backend, many browsers</span>
              <p className={quirkExplanationStyle}>
                Run the API where others can reach it and enter its URL manually once. The knobs that matter
                (<span className={inlineMonoStyle}>ADMIN_TOKEN</span>, the CORS origin allowlist,{' '}
                <span className={inlineMonoStyle}>HOST</span>) are documented in docs/DEPLOYMENT.md.
              </p>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className={sectionCardStyle}>
        <CardContent>
          <CardTitle as="h2">RPC provider quirks</CardTitle>
          <p className={paragraphStyle}>
            Public RPC endpoints are shared infrastructure and every provider draws its limits differently. These are
            the symptoms this explorer&rsquo;s error paths surface, what it already does about them, and the fix that
            remains on your side.
          </p>
          <ul className={quirkListStyle}>
            {RPC_QUIRKS.map(({ symptom, explanation }) => (
              <li key={symptom} className={quirkItemStyle}>
                <span className={quirkSymptomStyle}>{symptom}</span>
                <p className={quirkExplanationStyle}>{explanation}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className={sectionCardStyle}>
        <CardContent>
          <CardTitle as="h2">Local dev chains (anvil, Hardhat)</CardTitle>
          <p className={paragraphStyle}>
            Resetting anvil or a Hardhat node wipes the chain&rsquo;s history but keeps the same chain id &mdash; so
            everything this explorer cached-immutable from the previous incarnation (verified sources, storage
            layouts) may now be stale. The Home page&rsquo;s chain-reset banner detects the head going backwards and
            offers one-click clearing of that chain&rsquo;s cached data.
          </p>
          <p className={paragraphStyle}>
            Chains viem does not ship (private geth, new L2s; anvil&rsquo;s 31337 is built in) resolve once
            registered: use the chain selector (top right) &rarr; <em>Add custom chain</em>, or the{' '}
            <em>Connect this chain via RPC</em> card on the chain&rsquo;s own page. The registered RPC then serves
            every page on that chain.
          </p>
        </CardContent>
      </Card>

      <Card className={sectionCardStyle}>
        <CardContent>
          <CardTitle as="h2">Reading the coverage badges</CardTitle>
          <p className={paragraphStyle}>
            When numbers look wrong, the page&rsquo;s coverage badge says which case you are in: live, cached,
            discovered, sampled, partial or unavailable. A smaller number here usually means a smaller scan window
            or a coarser sample &mdash; not data missing from the chain. The full vocabulary, with a concrete
            example per level, lives on the{' '}
            <TypedLink to="/about/coverage" className={linkStyle}>
              data coverage page
            </TypedLink>
            .
          </p>
        </CardContent>
      </Card>

      <Card className={sectionCardStyle}>
        <CardContent>
          <CardTitle as="h2">Health checklist</CardTitle>
          <p className={paragraphStyle}>
            <code className={inlineMonoStyle}>curl http://localhost:8201/api/health</code> answers with five fields:
          </p>
          <ul className={healthListStyle}>
            {HEALTH_FIELDS.map(({ field, meaning }) => (
              <li key={field} className={healthItemStyle}>
                <span className={healthFieldStyle}>{field}</span>
                <p className={healthMeaningStyle}>{meaning}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className={sectionCardStyle}>
        <CardContent>
          <CardTitle as="h2">Still broken? Report it</CardTitle>
          <p className={paragraphStyle}>
            The Ops dashboard&rsquo;s <em>Copy diagnostics</em> button builds a JSON snapshot of the backend
            summary (version, storage sizes, per-section status) for pasting into a bug report; add the{' '}
            <span className={inlineMonoStyle}>/api/health</span> payload next to it. The repository&rsquo;s issue
            templates (<span className={inlineMonoStyle}>.github/ISSUE_TEMPLATE</span>) ask for exactly these two
            payloads plus the run mode and RPC provider class, so a report filed that way starts reproducible.
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
