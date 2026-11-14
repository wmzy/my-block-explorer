// The list pages' Refresh control, unified from five verbatim inline
// copies (blocks, contracts, tokens, transactions, pending): an outline
// sm button that disables while the page's query is in flight and flips
// its label to the busy form. Handlers may return a promise (refetch
// calls); like the former inline call sites, the result is fired and
// forgotten.
import { Button } from '@/components/ui/Button';

export function RefreshButton({
  onClick,
  fetching,
}: {
  onClick: () => void;
  fetching: boolean;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={fetching}>
      {fetching ? 'Refreshing…' : '↻ Refresh'}
    </Button>
  );
}
