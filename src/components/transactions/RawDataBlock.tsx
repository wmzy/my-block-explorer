import { css, cx } from '@linaria/core';
import { copyButtonBase } from '../ui/CopyButton';
import { toastCopy } from '@/util/clipboard';

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

// Shared copy-button chrome plus this block's xs-text delta (the button
// keeps its toastCopy tail — it is not a label-swap CopyButton).
const copyButtonStyle = cx(
  copyButtonBase,
  css`
    font-size: var(--haze-text-xs);
  `,
);

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
  // Shared copy+toast tail: the default wording this block always shipped.
  const handleCopy = () => toastCopy(data);

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
