// Tools hub (/tools): every tool the explorer ships on one page — the
// discoverability answer for features that live behind no topbar entry
// (SQL console, Ops, Signatures, Coverage legend, Broadcast) plus the
// chain-scoped pages, each with an honest one-line description of what it
// actually does. NOT chain-scoped itself: chain tools link through the
// remembered chain (the same readRememberedChainId the landing redirect
// uses — no second storage key), and say so with a "(remembered chain)"
// sub-label naming the chain. When nothing valid is remembered, the
// chain-scoped cards stay visible but render an honest "no chain
// remembered yet" note instead of a link — never a dead or guessed
// destination (the honesty contract applies to navigation too).
//
// This page is also the palette's touch fallback: the command palette is
// hidden below 768px, so the header points keyboard users at Ctrl/Cmd+K
// and everyone else at the cards below.
import { css } from '@linaria/core';
import { navigate } from '@native-router/core';
import { TypedLink, useRouter } from '@native-router/react';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainName } from '@/config/chains';
import { readRememberedChainId } from '@/views/Home/Landing';

// --- Pure card model (exported for the unit tests) ---

export type ToolCard = {
  id: string;
  title: string;
  description: string;
  /**
   * Destination, or null for cards that honestly have none: chain tools
   * with nothing remembered, and informational pointers (Backup & restore
   * lives in the settings modal — there is no page to link).
   */
  href: string | null;
  /** Renders the muted 'admin' chip (SQL console, Ops). */
  admin: boolean;
  /**
   * Sub-label naming the chain a chain-scoped card would open, e.g.
   * "Ethereum · remembered chain". Absent on global tools.
   */
  scopeNote?: string;
  /**
   * Honest copy shown instead of a link when href is null for a
   * chain-scoped reason (nothing remembered). Informational cards use
   * their description directly.
   */
  unavailableNote?: string;
};

export const NO_CHAIN_REMEMBERED_NOTE
  = 'No chain remembered yet — open any chain page first, then this card links there.';

/**
 * The hub's full card list. Pure: the remembered chain id and its display
 * name are resolved by the caller, so tests pin behavior without
 * touching localStorage or the chain config.
 */
export function buildToolCards(
  rememberedChainId: number | undefined,
  chainName: string | undefined,
): ToolCard[] {
  const chainPrefix = rememberedChainId === undefined ? null : `/chain/${rememberedChainId}`;
  const scopeNote = rememberedChainId === undefined
    ? undefined
    : `${chainName ?? `Chain ${rememberedChainId}`} · remembered chain`;

  // Chain-scoped card helper: with a remembered chain it links; without
  // one it keeps title + description and explains itself honestly.
  const chainCard = (
    id: string,
    suffix: string,
    title: string,
    description: string,
  ): ToolCard => ({
    id,
    title,
    description,
    href: chainPrefix === null ? null : `${chainPrefix}${suffix}`,
    admin: false,
    scopeNote,
    unavailableNote: chainPrefix === null ? NO_CHAIN_REMEMBERED_NOTE : undefined,
  });

  return [
    chainCard('blocks', '/blocks', 'Blocks', 'Recent blocks with finality labels and details.'),
    chainCard(
      'transactions',
      '/transactions',
      'Transactions',
      'Latest transactions with decoded method names.',
    ),
    chainCard(
      'pending',
      '/pending',
      'Pending',
      'The node\'s own pending pool (txpool) — live RPC, honest unsupported state when the node keeps it private.',
    ),
    chainCard(
      'broadcast',
      '/broadcast',
      'Broadcast',
      'Publish a locally signed raw transaction through the RPC this explorer uses for the chain, with a pre-flight decode.',
    ),
    chainCard(
      'contracts',
      '/contracts',
      'Contracts',
      'Directory of contracts cached by this explorer — verified sources, storage layouts, event indexing.',
    ),
    chainCard(
      'tokens',
      '/tokens',
      'Tokens',
      'Known tokens plus tokens opened in this browser, priced where DefiLlama resolves them.',
    ),
    chainCard(
      'charts',
      '/charts',
      'Charts',
      'Daily charts sampled client-side from RPC — the page labels its own sampling basis.',
    ),
    // The watchlist is a Home-page section (not its own route): the card
    // points at the chain home and says where to find it.
    chainCard(
      'watchlist',
      '',
      'Watchlist',
      'Saved addresses with live activity and optional webhook delivery — the watchlist section on the chain home page.',
    ),
    {
      id: 'search',
      title: 'Search',
      description: 'Cross-chain search through the backend index: addresses, blocks, transactions, tokens.',
      href: '/search',
      admin: false,
    },
    {
      id: 'signatures',
      title: 'Signatures',
      description: 'Resolve function selectors and event topic0 hashes (openchain-backed lookup).',
      href: '/signatures',
      admin: false,
    },
    {
      id: 'coverage',
      title: 'Coverage legend',
      description: 'What the live / cached-immutable / discovered / sampled chips on every page mean.',
      href: '/about/coverage',
      admin: false,
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      description:
        'RPC provider quirks (getLogs range caps, missing archive state, private txpool), dev-chain resets, the health checklist and how to report issues.',
      href: '/help/troubleshooting',
      admin: false,
    },
    {
      id: 'sql',
      title: 'SQL console',
      description:
        'Read-only, admin-gated queries against the explorer\'s main DuckDB (every chain\'s indexed rows). Not chain-scoped.',
      href: '/sql',
      admin: true,
    },
    {
      id: 'ops',
      title: 'Ops',
      description:
        'Operator dashboard: storage sizes, indexing/watch/deep-scan status, rate limits and backup guidance. Opt-in admin tier.',
      href: '/ops',
      admin: true,
    },
    {
      // Informational by design, not a degraded link: backup & restore is
      // a tab inside the settings modal — a card that linked nowhere would
      // overstate; this says exactly where it lives.
      id: 'backup',
      title: 'Backup & restore',
      description:
        'Lives in the settings modal — open the ⚙️ RPC button in the top bar; backup & restore is a tab there. It is not a separate page.',
      href: null,
      admin: false,
    },
  ];
}

// --- Styles ---

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--haze-space-4);
  align-items: stretch;
`;

const cardStyle = css`
  display: flex;
  flex-direction: column;
`;

const cardTitleRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
`;

const scopeNoteStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const cardBody = css`
  flex: 1;
`;

const cardFooter = css`
  margin-top: var(--haze-space-3);
`;

const openLink = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-primary);
  text-decoration: none;
`;

const unavailableNoteStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  font-style: italic;
`;

const infoNoteStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const paletteHint = css`
  margin-top: var(--haze-space-2);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
`;

// --- View ---

export default function Tools() {
  const router = useRouter();
  // Not chain-scoped, but the topbar still is (its links and search route
  // into /chain/:chainId pages): the remembered chain provides that
  // context, same fallback order as the other chain-less pages (SQL
  // console, Ops, Search).
  const remembered = readRememberedChainId();
  const navChainId = remembered ?? 1;
  const handleNavChainChange = (chainId: number) => {
    navigate(router, `/chain/${chainId}`).catch(() => undefined);
  };

  const cards = buildToolCards(
    remembered,
    remembered === undefined ? undefined : getChainName(remembered),
  );

  return (
    <>
      <TopNavigation currentChainId={navChainId} onChainChange={handleNavChainChange} />
      <PageContainer>
        <PageHeader
          title="Tools"
          chainInfo="Every tool in this explorer on one page. Chain tools follow the chain you were browsing; admin tools are marked with a chip."
        />
        <p className={paletteHint}>
          On a keyboard? Press Ctrl/Cmd+K anywhere for the command palette —
          the cards below are the full list and the touch-friendly way in.
        </p>
        <div className={grid}>
          {cards.map(card => (
            <Card key={card.id} className={cardStyle}>
              <CardHeader>
                <div className={cardTitleRow}>
                  <CardTitle>{card.title}</CardTitle>
                  {card.admin && (
                    <Badge variant="default" size="sm">
                      admin
                    </Badge>
                  )}
                </div>
                {card.scopeNote !== undefined && (
                  <div className={scopeNoteStyle}>{card.scopeNote}</div>
                )}
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent className={cardBody}>
                <div className={cardFooter}>
                  {card.href !== null ? (
                    <TypedLink
                      to={card.href}
                      className={openLink}
                      aria-label={`Open ${card.title}`}
                    >
                      Open →
                    </TypedLink>
                  ) : card.unavailableNote !== undefined ? (
                    <div className={unavailableNoteStyle}>{card.unavailableNote}</div>
                  ) : (
                    <div className={infoNoteStyle}>
                      No separate page — see the description above for where this lives.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageContainer>
    </>
  );
}
