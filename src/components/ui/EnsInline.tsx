// Inline ENS name for an address cell: an address link whose visible text
// upgrades in place to the verified ENS name once resolution settles. The
// row is never blocked and never changes height — the fallback text is the
// same short form the transactions list has always shown, loading and
// failure render that fallback (useEnsName surfaces both as null), and a
// resolved name is clamped to one ellipsized line. Resolution rides
// useEnsName (mainnet-pinned, reverse+forward roundtrip verified): a
// spoofed reverse record, an RPC failure, and a still-in-flight lookup all
// render the plain address — the only two visible states are "name" and
// "formatted address", never a placeholder or spinner.
import { css, cx } from '@linaria/core';
import { TypedLink } from '@native-router/react';

import { linkStyle } from '@/components/ui/DataTable';
import { useEnsName } from '@/services/ens';
import { formatAddress } from '@/utils/address';

// The truncation the transactions list has always rendered in address
// cells: 8 leading + 6 trailing hex chars around an ellipsis; a blank
// input degrades to 'N/A' (the creation-row branch renders it verbatim).
// Exported so the list's non-ENS branches keep byte-identical text.
export function shortAddress(address: string): string {
  if (!address) return 'N/A';
  if (address.length < 10) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

// One line, always: a resolved name replaces a 16-char address with text
// of arbitrary length, so the swap can never wrap the cell into a taller
// row — long names ellipsize instead.
const nameStyle = css`
  display: inline-block;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
`;

type EnsInlineProps = {
  address: string;
  chainId: number | undefined;
  enabled?: boolean;
};

// The resolving half, isolated as its own component so a disabled
// EnsInline never mounts the query hook at all — bounding RPC fan-out is
// a call-count guarantee, not just a gated argument (rules-of-hooks
// forbids calling the hook conditionally in one component).
function ResolvedEnsName({ address, chainId }: { address: string; chainId: number }) {
  const { data: name } = useEnsName(address, chainId);
  // null covers loading, no reverse record, unverifiable roundtrip, and
  // RPC failure alike — the formatted address is the single fallback.
  return <>{name ?? shortAddress(address)}</>;
}

export function EnsInline({ address, chainId, enabled = true }: EnsInlineProps) {
  // The hover affordance: the FULL checksummed (EIP-55) address, in both
  // the name and fallback renderings — the truncated text is never the
  // only copy of the address on screen.
  const title = formatAddress(address);

  const body =
    enabled && chainId !== undefined ? (
      <ResolvedEnsName address={address} chainId={chainId} />
    ) : (
      shortAddress(address)
    );

  // Without a chain there is no address page to link to: degrade to the
  // plain formatted text (still never a fabricated name — a name with no
  // destination is not worth its resolution).
  if (chainId === undefined) {
    return <span title={title}>{body}</span>;
  }

  return (
    <TypedLink
      to={`/chain/${chainId}/address/${address}`}
      className={cx(linkStyle, nameStyle)}
      title={title}
    >
      {body}
    </TypedLink>
  );
}
