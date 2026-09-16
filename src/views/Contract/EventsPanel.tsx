import { useState, useCallback } from 'react';
import type { AbiEvent } from 'viem';
import IndexingRangeManager from '@/components/events/IndexingRangeManager';
import EventStatistics from '@/components/events/EventStatistics';
import EventTable from '@/components/events/EventTable';

// Events tab: indexing controls, statistics and the event table share one
// refresh signal — an indexing-range update or statistics refresh bumps the
// key so the table refetches.
export function EventsPanel({
  chainId,
  contractAddress,
  abiEvents,
  creationBlock,
  abi,
}: {
  chainId: number;
  contractAddress: `0x${string}`;
  abiEvents: unknown[];
  creationBlock?: number;
  abi?: unknown[];
}) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleEventsUpdated = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  return (
    <>
      <IndexingRangeManager
        chainId={chainId}
        contractAddress={contractAddress}
        creationBlock={creationBlock}
        abi={abi}
        onRefresh={handleEventsUpdated}
      />
      <EventStatistics
        chainId={chainId}
        contractAddress={contractAddress}
        onRefresh={handleEventsUpdated}
        onEventsUpdated={handleEventsUpdated}
      />
      <EventTable
        chainId={chainId}
        contractAddress={contractAddress}
        abiEvents={abiEvents as AbiEvent[]}
        enableDynamicFiltering={true}
        refreshKey={refreshKey}
      />
    </>
  );
}
