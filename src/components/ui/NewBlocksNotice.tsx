// The staleness hint strip shared by the Blocks and Transactions lists:
// the polled live head moved past the page's anchor (the frozen walk head
// or the fetch-time snapshot), so the page says "N new blocks — Refresh"
// instead of letting Age cells silently creep. The Refresh control is the
// caller's — one click re-anchors the walk (Blocks) or re-pulls page 1 of
// the current anchor (Transactions). A null count renders nothing: a head
// at or below the anchor is not stale news.
import { Button } from './Button';
import { noticeBarStyle } from './noticeBar';
import { formatNumber } from '@/utils/format';

type NewBlocksNoticeProps = {
  /** Blocks the live head is ahead of the page's anchor; null hides the notice. */
  count: number | null;
  /** True while the caller's re-anchor fetch is in flight. */
  refreshing: boolean;
  onRefresh: () => void;
};

export function NewBlocksNotice({ count, refreshing, onRefresh }: NewBlocksNoticeProps) {
  if (count === null) return null;

  return (
    <div className={noticeBarStyle}>
      <span>
        {formatNumber(count)} new {count === 1 ? 'block' : 'blocks'} —
      </span>
      <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing}>
        Refresh
      </Button>
    </div>
  );
}
