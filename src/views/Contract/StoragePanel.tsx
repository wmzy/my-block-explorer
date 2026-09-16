import { useStorageLayout } from '@/services/contracts';
import { StorageLayoutView } from '@/components/storage';
import { cardStyles, errorStyles, loadingStyles } from './styles';
import type { ContractSource } from './types';

// Storage tab: the proxy/impl toggle decides which address the layout is
// read for; layout data is the StorageLayout itself (services/contracts
// unwraps the old {found, layout} envelope).
export function StoragePanel({
  chainId,
  address,
  contractSource,
  contractTarget,
}: {
  chainId: number;
  address: `0x${string}`;
  contractSource: ContractSource | null;
  contractTarget: 'proxy' | 'impl';
}) {
  const targetAddress =
    contractTarget === 'impl' ? (contractSource?.implementationAddress ?? address) : address;

  const { data: layout, loading, error } = useStorageLayout(chainId, targetAddress);

  const isProxy = contractSource?.isProxy && !!contractSource?.implementationAddress;

  if (!isProxy && contractSource?.verificationStatus !== 'verified') {
    return (
      <div className={cardStyles}>
        <h2>Storage Layout</h2>
        <div className={errorStyles}>Storage layout is only available for verified contracts.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cardStyles}>
        <h2>Storage Layout</h2>
        <div className={loadingStyles}>Loading storage layout...</div>
      </div>
    );
  }

  if (error || !layout) {
    return (
      <div className={cardStyles}>
        <h2>Storage Layout</h2>
        <div className={errorStyles}>
          {error instanceof Error
            ? error.message
            : 'Storage layout not available for this contract.'}
        </div>
      </div>
    );
  }

  return (
    <div className={cardStyles}>
      <StorageLayoutView chainId={chainId} address={targetAddress} layout={layout} />
    </div>
  );
}
