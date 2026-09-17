import { useStorageLayout } from '@/services/contracts';
import { StorageLayoutView } from '@/components/storage';
import { cardStyles, errorStyles, loadingStyles } from './styles';
import type { ContractSource } from './types';

// Storage tab: the proxy/impl toggle decides which address the layout is
// read for; the hook returns the raw {found, layout, source} envelope, and
// `source` distinguishes verified/fetched layouts from evmole bytecode
// inference on unverified contracts.
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
  const layoutAddress =
    contractTarget === 'impl' ? (contractSource?.implementationAddress ?? address) : address;
  // Slot values are always read at the address users actually interact with:
  // for a proxy that is the proxy address in BOTH toggle positions — the
  // delegatecall target's own storage is empty/irrelevant. For non-proxy
  // contracts this trivially equals `address`.
  const valueAddress = address;

  const { data: response, loading, error } = useStorageLayout(chainId, layoutAddress);
  const layout = response?.layout;
  const layoutSource = response?.source;

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
      {layoutSource === 'evmole' && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: '12px',
            background: '#fff8e1',
            border: '1px solid #856404',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#856404',
          }}
        >
          Inferred from bytecode (unverified contract)
        </div>
      )}
      <StorageLayoutView
        chainId={chainId}
        address={layoutAddress}
        valueAddress={valueAddress}
        layout={layout}
      />
    </div>
  );
}
