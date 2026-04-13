import { css, cx } from '@linaria/core';
import type { ExternalTool } from '../../config/externalTools';

const containerStyle = css`
  display: flex;
  flex-wrap: wrap;
  gap: var(--haze-space-2);
`;

const linkStyle = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1);
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-xs);
  font-family: var(--haze-font-mono);
  color: var(--haze-color-text-muted);
  background: var(--haze-color-bg-muted);
  border-radius: var(--haze-radius-full);
  text-decoration: none;
  transition: all 0.15s ease;
  border: 1px solid transparent;

  &:hover {
    color: var(--haze-color-text);
    background: color-mix(in srgb, var(--haze-color-primary) 10%, transparent);
    border-color: color-mix(in srgb, var(--haze-color-primary) 30%, transparent);
  }
`;

const arrowStyle = css`
  font-size: 10px;
  opacity: 0.5;
`;

type ExternalLinksProps = {
  links: ExternalTool[];
  className?: string;
};

export function ExternalLinks({ links, className }: ExternalLinksProps) {
  if (links.length === 0) return null;

  return (
    <div className={cx(containerStyle, className)}>
      {links.map(link => (
        <a
          key={link.name}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className={linkStyle}
        >
          {link.name}
          <span className={arrowStyle}>↗</span>
        </a>
      ))}
    </div>
  );
}
