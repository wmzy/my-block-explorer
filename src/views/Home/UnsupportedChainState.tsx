// Explicit unsupported-chain state shared by Home and the other chain views.
// A deep link to an id the config cannot resolve (e.g. /chain/999999)
// used to be silently redirected to the viewer's own remembered chain (a
// shared link silently opening a DIFFERENT chain) or rendered a bare error
// with no way forward. Instead this state names the requested id and
// offers deterministic recovery CTAs:
// - "Go to Mainnet" (or the preferred chain): a fixed destination that does
//   NOT depend on the viewer's remembered chain — a shared link must not
//   bounce different visitors to different chains.
// - "Open a supported chain": links to the popular chains from the config,
//   rendered right in the card. The old "Open chain list" button pointed
//   at '/', which the landing redirect resolves through the viewer's
//   remembered chain — the exact dishonest bounce this state exists to
//   avoid — so every recovery link targets a concrete /chain/:id.
// - "Connect this chain via RPC": for an id viem does not ship, the
//   shared AddCustomChainForm registers the chain through the backend
//   (which probes the RPC's eth_chainId) and navigates into it — the
//   dead end becomes the onboarding path for anvil/hardhat/private
//   chains. Before any of this renders as a verdict, the state consults
//   the backend's custom registrations once (ensureCustomChainsLoaded):
//   a chain registered in an earlier session resolves and redirects
//   instead of dead-ending.
import { useEffect, useState } from 'react';
import { css, cx } from '@linaria/core';
import { TypedLink, useMatched } from '@native-router/react';
import { ErrorState } from '@/components/ui/ErrorState';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { AddCustomChainForm } from '@/components/AddCustomChainForm';
import { POPULAR_CHAINS, getChainInfo, getChainName } from '@/config/chains';
import { ensureCustomChainsLoaded } from '@/services/customChains';
import { parseChainIdParam } from '@/utils/chainParam';
import { getPreferredChainId, redirectReplace } from './Landing';

const ctaRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
  margin-bottom: var(--haze-space-4);
`;

// Button-scale links modeled on PageLayout's BackButton so the CTAs read as
// actions, not body-text links. Doubles as the base style of the
// popular-chain links so the whole recovery block reads as one family.
const ctaLink = css`
  display: inline-block;
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  padding: var(--haze-space-2) var(--haze-space-4);
  color: var(--haze-color-text-muted);
  text-decoration: none;
  font-size: var(--haze-text-sm);
  font-family: var(--haze-font-sans);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text);
    border-color: var(--haze-color-border-hover);
  }
`;

// Popular-chain links stack the name over the id inside one button-scale
// link (the base look comes from ctaLink via cx).
const chainLink = css`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--haze-space-1);
`;

const chainLinkMeta = css`
  font-size: var(--haze-text-xs);
  font-family: var(--haze-font-mono);
  color: var(--haze-color-text-muted);
`;

// Responsive grid: several chains per row on wide viewports, down to one
// per row on narrow ones, without a breakpoint dance.
const chainGrid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--haze-space-2);
`;

// Intro copy for the RPC recovery card: what the flow does and where the
// chain id comes from (the endpoint's own answer — never the URL).
const connectHint = css`
  margin: 0 0 var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

export function UnsupportedChainState({
  chainId,
  rawChainId,
}: {
  chainId: number;
  /**
   * The raw :chainId param when the caller parsed it (e.g. "abc"): lets
   * the state distinguish a broken link from an unknown-but-valid id.
   */
  rawChainId?: string;
}) {
  const { router } = useMatched();

  // Preferred chain, NOT the remembered one (see the module header).
  const preferredChainId = getPreferredChainId();
  const preferredChainName = getChainName(preferredChainId);

  // Two different problems share this state: a well-formed id the config
  // cannot resolve (999999) and a param that is not a chain id at all
  // ("abc", "0x1", "1e5"). The second used to render a bare "chain ID NaN".
  const invalidId =
    rawChainId !== undefined ? parseChainIdParam(rawChainId) === null : !Number.isFinite(chainId);
  // What to name in the invalid message: the raw param when the caller
  // kept it, else a generic phrase (no raw string is available).
  const namedParam = rawChainId !== undefined ? `"${rawChainId}"` : 'the value in this URL';

  // Before a well-formed id is declared unsupported, the backend's custom
  // registrations must have been consulted once: a chain registered in an
  // earlier session (the row lives in the backend's database) resolves
  // here and the deep link recovers instead of dead-ending. The load
  // never blocks rendering and never fails the page — worst case it
  // settles without the chain and the honest unsupported state stands.
  const [registryChecked, setRegistryChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    ensureCustomChainsLoaded().finally(() => {
      if (!cancelled) setRegistryChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const registeredChainId
    = registryChecked && !invalidId ? (getChainInfo(chainId)?.id ?? null) : null;

  // Recovery redirect for a late-resolved registration. Replace (not
  // push): the unsupported URL is not a place worth keeping in history.
  // The effect depends on the resolved ID (a stable number), never the
  // chain object — getChainInfo builds a fresh object per call, which
  // would re-fire this redirect on every render.
  useEffect(() => {
    if (registeredChainId !== null) {
      redirectReplace(router, `/chain/${registeredChainId}`).catch(() => undefined);
    }
  }, [registeredChainId, router]);

  const openRegisteredChain = (targetChainId: number) => {
    redirectReplace(router, `/chain/${targetChainId}`).catch(() => undefined);
  };

  const message = invalidId
    ? `Invalid chain ID: ${namedParam} is not a valid chain ID (expected a decimal number like 1 or 11155111), so no chain data can be shown.`
    : `Chain not supported: this explorer has no configuration for chain ID ${chainId}, so none of its data can be shown.`;

  return (
    <div>
      <ErrorState message={message} />
      <div className={ctaRow}>
        <TypedLink to={`/chain/${preferredChainId}`} className={ctaLink}>
          {preferredChainId === 1 ? 'Go to Mainnet' : `Go to ${preferredChainName}`}
        </TypedLink>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Open a supported chain</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={chainGrid}>
            {POPULAR_CHAINS.map(chain => (
              <TypedLink
                key={chain.id}
                to={`/chain/${chain.id}`}
                className={cx(ctaLink, chainLink)}
              >
                <span>{getChainName(chain.id)}</span>
                <span className={chainLinkMeta}>Chain ID: {chain.id}</span>
              </TypedLink>
            ))}
          </div>
        </CardContent>
      </Card>
      {!invalidId && (
        <Card>
          <CardHeader>
            <CardTitle>Connect this chain via RPC</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={connectHint}>
              {'Running a chain this explorer does not know (anvil, hardhat, a private node)? '}
              {'Point it at the RPC endpoint — the explorer asks the endpoint for its chain ID '}
              and registers everything from there.
            </p>
            <AddCustomChainForm
              expectedChainId={chainId}
              onAdded={chain => openRegisteredChain(chain.chainId)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
