// Explicit unsupported-chain state shared by Home and the Blocks views.
// A deep link to an id the config cannot resolve (e.g. /chain/999999)
// used to be silently redirected to the viewer's own remembered chain (a
// shared link silently opening a DIFFERENT chain) or rendered a bare error
// with no way forward. Instead this state names the requested id and
// offers deterministic recovery CTAs:
// - "Go to Mainnet" (or the preferred chain): a fixed destination that does
//   NOT depend on the viewer's remembered chain — a shared link must not
//   bounce different visitors to different chains.
// - "Open chain list": the landing route ('/'), where the landing redirect
//   resolves the entry chain and the top navigation's chain selector offers
//   the full list (anchoring straight to the selector is not reachable
//   without an id contract on the navigation component).
import { css } from '@linaria/core';
import { TypedLink } from '@native-router/react';
import { ErrorState } from '@/components/ui/ErrorState';
import { getChainName } from '@/config/chains';
import { parseChainIdParam } from '@/utils/chainParam';
import { getPreferredChainId } from './Landing';

const ctaRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
`;

// Button-scale links modeled on PageLayout's BackButton so the CTAs read as
// actions, not body-text links.
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
        <TypedLink to="/" className={ctaLink}>
          Open chain list
        </TypedLink>
      </div>
    </div>
  );
}
