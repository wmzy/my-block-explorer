import { useState, useCallback } from 'react';
import { css } from '@linaria/core';
import type { AbiEvent } from 'viem';
import IndexingRangeManager from '@/components/events/IndexingRangeManager';
import EventStatistics from '@/components/events/EventStatistics';
import EventTable from '@/components/events/EventTable';

// One-line scope note distinguishing this tab's storage-backed listing from
// the address page's on-demand RPC scans.
const dataSourceCaptionStyle = css`
  display: block;
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--haze-text-secondary, #6b7280);
`;

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
      <span className={dataSourceCaptionStyle}>
        Data source: your local event index (DuckDB), not an on-demand RPC scan
      </span>
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
