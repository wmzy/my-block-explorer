import { css } from '@linaria/core';
import { useToast } from 'haze-ui';

const blockStyle = css`
  margin-top: var(--haze-space-4);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  background: var(--haze-color-bg-subtle);
  padding: var(--haze-space-3);
`;

const headerStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-3);
  margin-bottom: var(--haze-space-2);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
`;

const copyButtonStyle = css`
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  background: var(--haze-color-bg);
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-xs);
  cursor: pointer;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

const dataStyle = css`
  margin: 0;
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  word-break: break-all;
  white-space: pre-wrap;
`;

type RawDataBlockProps = {
  /** Small caption above the blob, e.g. "Raw Input". */
  title: string;
  /** The verbatim hex payload to display and copy. */
  data: string;
};

/**
 * Monospace, word-broken raw hex blob with a clipboard copy affordance —
 * the always-available fallback surface for input data and log payloads.
 */
export function RawDataBlock({ title, data }: RawDataBlockProps) {
  const toast = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data);
      toast('Copied to clipboard!', { variant: 'success', duration: 2000 });
    } catch {
      toast('Failed to copy', { variant: 'danger', duration: 2000 });
    }
  };

  return (
    <div className={blockStyle}>
      <div className={headerStyle}>
        <span>{title}</span>
        <button type="button" className={copyButtonStyle} onClick={handleCopy}>
          Copy
        </button>
      </div>
      <pre className={dataStyle}>{data}</pre>
    </div>
  );
}
