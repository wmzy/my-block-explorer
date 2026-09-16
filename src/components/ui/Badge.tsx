import { css, cx } from '@linaria/core';
// Per-component submodule imports instead of the 'haze-ui' barrel: the local
// wrappers share the component names, so barrel imports would need `as`
// aliases — which vite-plugin-haze-ui (1.0.1) cannot map to CSS when the
// braces keep Prettier's inner spaces. Non-barrel specifiers are outside the
// plugin's collection; the explicit CSS side-effect imports below mirror what
// the plugin injects for barrel imports (css-manifest.json families:
// Badge -> badge, Tag -> tag).
import { Badge as HazeBadge } from 'haze-ui/components/Badge';
import { Tag as HazeTag } from 'haze-ui/components/Tag';
import 'haze-ui/css/badge.css';
import 'haze-ui/css/tag.css';
import type { ReactNode, HTMLAttributes } from 'react';

const variantMap = {
  default: 'default',
  success: 'success',
  warning: 'warning',
  error: 'danger',
  info: 'info',
  purple: 'info',
} as const;

const clickableStyle = css`
  cursor: pointer;
`;

export type BadgeProps = {
  variant?: keyof typeof variantMap;
  size?: 'sm' | 'md';
  children: ReactNode;
  className?: string;
} & Pick<HTMLAttributes<HTMLElement>, 'onClick'>;

export function Badge({
  variant = 'default',
  size = 'md',
  children,
  className,
  onClick,
}: BadgeProps) {
  return (
    <span onClick={onClick} className={cx(onClick ? clickableStyle : undefined, className)}>
      <HazeBadge variant={variantMap[variant]} size={size}>
        {children}
      </HazeBadge>
    </span>
  );
}

const statusDot = css`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
`;

const statusColors = {
  online: css`
    background-color: var(--haze-color-success);
  `,
  offline: css`
    background-color: var(--haze-color-danger);
  `,
  pending: css`
    background-color: var(--haze-color-warning);
  `,
  unknown: css`
    background-color: var(--haze-color-text-muted);
  `,
};

const statusTagVariant = {
  online: 'success',
  offline: 'danger',
  pending: 'warning',
  unknown: 'default',
} as const;

export type StatusBadgeProps = {
  status: keyof typeof statusColors;
  children: ReactNode;
  className?: string;
};

export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  return (
    <HazeTag variant={statusTagVariant[status]} size="sm" className={className}>
      <span className={cx(statusDot, statusColors[status])} />
      {children}
    </HazeTag>
  );
}
