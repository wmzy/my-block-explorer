import { Badge } from '@/components/ui/Badge';

// One status badge for every transaction row, so the three surfaces that
// show a transaction's outcome (the chain-wide list, the tx detail page and
// the address activity table) cannot drift apart on what an unknown status
// means.
//
// status: 1 → success, 0 → failed, anything else → we have no receipt
// verdict. That last case is the one a naive badge gets wrong: -1 means
// "no receipt yet", which is only "pending" for a transaction with no block
// position. A MINED transaction whose receipt the RPC could not return (or
// whose status the address heuristic discovered from block data alone) is
// not pending — it is in a block, and claiming "Pending" asserts something
// the chain already disproved (while the same row links its block). It reads
// "Unknown" instead. `hasBlock` carries the witness: a non-null block number.
export function TxStatusBadge({
  status,
  hasBlock,
}: {
  status: number | null | undefined;
  hasBlock: boolean;
}) {
  if (status === 1) {
    return (
      <Badge variant="success" size="sm">
        Success
      </Badge>
    );
  }
  if (status === 0) {
    return (
      <Badge variant="error" size="sm">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="default" size="sm">
      {hasBlock ? 'Unknown' : 'Pending'}
    </Badge>
  );
}

export default TxStatusBadge;
