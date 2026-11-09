// Traced-progress loading state shared by the two internal-transactions
// surfaces (the address page's Internal Txns tab and the block detail
// page's traced Internal Transactions card): the honest progress line in
// traced-transaction counts both owe the user while the on-demand sweep
// settles. The surfaces' shared styles live in components/internalTxnsShared.
import { LoadingState } from '@/components/ui/LoadingState';

export function TracedProgress({ settled, total }: { settled: number; total: number }) {
  return (
    <LoadingState
      message={`Traced ${settled.toLocaleString()} of ${total.toLocaleString()} transactions…`}
    />
  );
}
