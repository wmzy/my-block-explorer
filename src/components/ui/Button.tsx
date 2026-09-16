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

const spinnerStyle = css`
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top: 2px solid currentColor;
  border-radius: 50%;
  animation: haze-btn-spin 1s linear infinite;
  @keyframes haze-btn-spin {
    to {
      transform: rotate(360deg);
    }
  }
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
      {loading && <span className={spinnerStyle} />}
      {children}
    </HazeButton>
  );
}
