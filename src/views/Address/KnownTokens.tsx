// Known Tokens section of the address Overview card: a live balanceOf
// check against the curated per-chain list (services/knownTokenBalances —
// ONE Multicall3 batch), rendered right after the Token Holdings
// (discovered) section. Complements the scan-derived holdings: this
// surface fires for EVERY address (EOA and contract — one cheap
// multicall), so an address with no discovered transfers still shows real
// balances, and the basis line keeps the check honest about being a
// curated sample, never a complete asset list. Errors and in-flight
// states render nothing (clean absence, the addressRealTime degradation
// convention for live-RPC surfaces); symbol/decimals truth resolves at
// runtime through the transfers tab's shared session metadata cache.
import { css, cx } from '@linaria/core';
import { useMemo, type ReactNode } from 'react';
import { TypedLink } from '@native-router/react';
import { formatUnits } from 'viem';

import { CopyableHash } from '@/components/ui/CopyableHash';
import { linkStyle } from '@/components/ui/DataTable';
import { InfoItem } from '@/components/ui/InfoGrid';
import { UsdValue } from '@/components/ui/UsdValue';
import { knownTokensForChain } from '@/config/knownTokens';
import {
  capKnownTokenRows,
  filterNonZeroKnownTokenBalances,
  orderKnownTokenRows,
  useKnownTokenBalances,
  type KnownTokenBalance,
} from '@/services/knownTokenBalances';
import { tokenAmountToUsd, useTokenUsdPrices, type UsdPriceSnapshot } from '@/services/prices';
import { useTokenMetas, type TokenMeta } from '@/views/Address/TokenTransfers';

// One held-token row: linked symbol on the left (CopyableHash conventions
// — full address in the tooltip, navigation to the token page), amount +
// USD on the right. Same mono/xs treatment as the discovered-holdings
// rows above; stacks like them on narrow screens.
const knownTokenRow = css`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--haze-space-1) var(--haze-space-2);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  margin-bottom: var(--haze-space-1);

  @media (max-width: 768px) {
    justify-content: flex-start;
  }
`;

// "and N more" affordance under the capped rows — a link into the
// address's transfers tab, where the full transfer-derived picture lives.
const moreLink = css`
  display: block;
  margin: 0 0 var(--haze-space-1);
`;

// Checked-but-empty state: an honest zero over an explicit check, never a
// silently missing section (the section already names the checked count).
const knownTokensEmpty = css`
  display: block;
  margin-bottom: var(--haze-space-2);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Mandatory basis line: renders with every list — the balances are live
// reads over a CURATED sample, never a complete asset inventory.
const knownTokensCaveat = css`
  margin: var(--haze-space-2) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

/** One display row (pure props, no hooks). */
function KnownTokenRow({
  chainId,
  row,
  symbol,
  meta,
  price,
}: {
  chainId: number;
  row: KnownTokenBalance;
  symbol: string;
  meta: TokenMeta | undefined;
  price: UsdPriceSnapshot | undefined;
}) {
  // Amount with the METADATA decimals (never the curated hint — a wrong
  // hardcoded guess can never reach the UI). Decimals unresolved (still
  // loading or unreadable) shows the raw base units, titled as such.
  const decimals = meta?.decimals;
  const amount =
    decimals !== undefined ? (
      <span title={`${row.balance.toString()} base units`}>
        {formatUnits(row.balance, decimals)}
      </span>
    ) : (
      <span title="Token decimals unknown — raw value">{row.balance.toString()}</span>
    );

  // USD only when BOTH the decimals and a usable price snapshot landed —
  // UsdValue itself stays silent on stale/unavailable prices.
  const usd =
    decimals !== undefined && price !== undefined
      ? tokenAmountToUsd(row.balance, decimals, price)
      : null;

  return (
    <div className={knownTokenRow}>
      <CopyableHash
        value={row.address}
        href={`/chain/${chainId}/token/${row.address}`}
        truncated={symbol}
      />
      {amount}
      {usd !== null && price !== undefined && <UsdValue usd={usd} price={price} />}
    </div>
  );
}

export type KnownTokensProps = {
  chainId: number;
  address: string;
};

/**
 * "Known Tokens (checked N)" section: live balances over the curated
 * list, USD-sorted and capped, with the sample-basis caveat. Renders
 * nothing while the check is in flight, for RPC failures, or on chains
 * without a curated list.
 */
export function KnownTokens({ chainId, address }: KnownTokensProps): ReactNode {
  const curated = knownTokensForChain(chainId);
  // Hint lookup keyed by lowercase address (metadata/prices maps key the
  // same way); the hint only ever backfills an unresolved runtime symbol.
  const hints = useMemo(
    () => new Map(curated.map((token) => [token.address.toLowerCase(), token.symbol])),
    [curated],
  );

  // Cache identity is the lowercase address (multicall args + payload key).
  const owner = useMemo(() => address.trim().toLowerCase(), [address]);

  const query = useKnownTokenBalances(chainId, owner);

  // Cross-args guard (approvals pattern): the query store keeps the last
  // settle across an args switch, so another key's payload is absent.
  const data = query.data?.chainId === chainId && query.data.address === owner
    ? query.data
    : undefined;

  const rows = useMemo(
    () => (data === undefined ? [] : filterNonZeroKnownTokenBalances(data.balances)),
    [data],
  );
  const rowTokens = useMemo(
    () => rows.map((row) => row.address.toLowerCase()),
    [rows],
  );

  // Runtime symbol/decimals through the SHARED session cache (the
  // transfers tab and discovered-holdings section already use it, so
  // tokens they resolved cost nothing here).
  const metas = useTokenMetas(chainId, rowTokens);
  const prices = useTokenUsdPrices(chainId, rowTokens);

  // USD-known first (desc), then raw balance (desc); prices may still be
  // settling (all-null usdOf → balance order), then re-sort when they land.
  const priced = useMemo(
    () =>
      orderKnownTokenRows(rows, (row) => {
        const lower = row.address.toLowerCase();
        const decimals = metas[lower]?.decimals;
        const price = prices?.get(lower);
        if (decimals === undefined || price === undefined) return null;
        return tokenAmountToUsd(row.balance, decimals, price);
      }),
    [rows, metas, prices],
  );
  const capped = useMemo(() => capKnownTokenRows(priced), [priced]);

  // Gates AFTER the hooks (rules-of-hooks): chains without a curated list
  // have nothing to check (never an empty-wallet claim), and in-flight or
  // failed checks render as clean absence — this is a live-RPC surface.
  if (chainId <= 0 || curated.length === 0) return null;
  if (data === undefined) return null;

  return (
    <InfoItem label="Known Tokens">
      <div>
        {capped.shown.map((row) => {
          const lower = row.address.toLowerCase();
          return (
            <KnownTokenRow
              key={lower}
              chainId={chainId}
              row={row}
              symbol={metas[lower]?.symbol ?? hints.get(lower) ?? row.address}
              meta={metas[lower]}
              price={prices?.get(lower)}
            />
          );
        })}
        {capped.hidden > 0 && (
          <TypedLink
            to={`/chain/${chainId}/address/${address}`}
            search={{ tab: 'transfers' }}
            className={cx(linkStyle, moreLink)}
          >
            and {capped.hidden} more →
          </TypedLink>
        )}
        {rows.length === 0 && (
          <span className={knownTokensEmpty}>
            None of the {data.checked} checked known tokens are held.
          </span>
        )}
        <p className={knownTokensCaveat}>
          checked {data.checked} known tokens — live balances, not a complete asset list
        </p>
      </div>
    </InfoItem>
  );
}

export default KnownTokens;
