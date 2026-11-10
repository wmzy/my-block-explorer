import { css, cx } from '@linaria/core';
import { Tooltip } from 'haze-ui';
import { TypedLink } from '@native-router/react';
import { linkStyle } from './DataTable';
import { toastCopy } from '@/util/clipboard';

const copyable = css`
  cursor: pointer;
  /* Click-to-copy affordance: the hover dim glides in (the title tooltip
     carries the full value; the cursor signals the action). */
  transition: opacity var(--haze-duration-fast, 0.12s) var(--haze-ease, ease);

  &:hover {
    opacity: 0.8;
  }
`;

type CopyableHashProps = {
  value: string;
  truncated?: string;
  href?: string;
  className?: string;
};

export function CopyableHash({ value, truncated, href, className }: CopyableHashProps) {
  const handleCopy = async (e: React.MouseEvent) => {
    if (href) return;
    e.preventDefault();
    // Shared copy+toast tail: the default wording this cell always shipped.
    await toastCopy(value);
  };

  const display = truncated ?? value;

  const content = href ? (
    <TypedLink to={href} className={cx(linkStyle, className)}>
      {display}
    </TypedLink>
  ) : (
    <span className={cx(linkStyle, copyable, className)} onClick={handleCopy}>
      {display}
    </span>
  );

  return (
    <Tooltip content={value} position="top">
      {content}
    </Tooltip>
  );
}
