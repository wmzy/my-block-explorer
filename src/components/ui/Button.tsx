import { css, cx } from '@linaria/core';
// Imported from the per-component submodule instead of the 'haze-ui' barrel:
// the local wrapper shares the component's name, so a barrel import would need
// an `as` alias — and vite-plugin-haze-ui (1.0.1) fails to map aliased named
// imports whose braces keep Prettier's inner spaces. Non-barrel specifiers are
// outside the plugin's collection; the explicit CSS side-effect import below
// mirrors exactly what the plugin injects for barrel imports
// (haze-ui css-manifest.json families: Button -> button).
import { Button as HazeButton } from 'haze-ui/components/Button';
import 'haze-ui/css/button.css';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

// The border-spinner shape shared by this button's loading state and the
// events table's loading pane: a round 2px track with one lit quadrant
// spinning at a fixed 1s linear cadence. Linaria scopes keyframes per css
// block, so — the skeleton.ts convention — the reusable base must declare
// BOTH the animation and its keyframes (no parameterized factory: wyw-in-js
// rejects interpolating function parameters into css templates). Sizes and
// colors are site deltas composed on top via cx; track/indicator colors
// flow through custom properties carrying this button's own defaults, so
// other sites recolor without colliding `border` declarations whose cx
// order does not guarantee cascade order in the emitted stylesheet.
export const spinnerBase = css`
  border-radius: 50%;
  border: 2px solid var(--spinner-track, transparent);
  border-top: 2px solid var(--spinner-indicator, currentColor);
  animation: ui-spinner-spin 1s linear infinite;

  @keyframes ui-spinner-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

// The button's own loading size — colors come from the base defaults
// (transparent track, currentColor quadrant).
const spinnerStyle = css`
  width: 16px;
  height: 16px;
`;

const variantMap = {
  primary: 'solid',
  secondary: 'outline',
  outline: 'outline',
  ghost: 'ghost',
  danger: 'solid',
} as const;

const dangerStyle = css`
  --haze-color-primary: var(--haze-color-danger);
  --haze-color-primary-hover: #b91c1c;
  --haze-color-primary-active: #991b1b;
`;

export type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
} & Omit<ComponentPropsWithoutRef<'button'>, 'type'>;

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const hazeVariant = variantMap[variant];

  return (
    <HazeButton
      variant={hazeVariant}
      size={size}
      className={cx(variant === 'danger' ? dangerStyle : undefined, className)}
      disabled={disabled ?? loading}
      {...rest}
    >
      {loading && <span className={cx(spinnerBase, spinnerStyle)} />}
      {children}
    </HazeButton>
  );
}
