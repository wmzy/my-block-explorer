import { css } from '@linaria/core';

// Styles shared by the view shell and the tab panels; panel-specific styles
// stay colocated with their components.
//
// The color families below are the contract pages' canonical replacement
// for the bootstrap-era hardcoded palette, following haze-ui's own
// Alert/Badge recipes so every surface flips correctly with the active
// theme:
//   blue buttons/links (bootstrap blue)   → primary / primary-hover + text-inverse
//   success boxes (pale green tints)      → success-subtle + success
//   error boxes (pale red tints)          → danger-subtle + danger
//   amber notices (cream/amber tints)     → warning-subtle + warning
//   hover backgrounds (near-white tint)   → bg-subtle
//   white literals (background/color)     → bg / text-inverse
// Panels compose these via cx() and keep only their spacing/typography
// locally; borders on tinted surfaces use color-mix of the role token
// because the theme ships no dedicated border-on-role token.

export const cardStyles = css`
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 20px;

  h2 {
    font-size: 18px;
    margin: 0 0 16px 0;
    color: var(--haze-color-text);
  }

  /* Phone widths: trade inner padding for content width — mono hashes and
     code blocks get the room the gutters were wasting. */
  @media (max-width: 768px) {
    padding: 16px;
  }
`;

export const loadingStyles = css`
  text-align: center;
  padding: 40px;
  color: var(--haze-color-text-muted);
`;

// Spacing delta for page-level error boxes on top of the shared error
// family (the family owns background/border/color/padding/radius).
export const errorStyles = css`
  margin-bottom: 20px;
`;

// Soft notice boxes: role-tinted background with the role color as text
// (the haze-ui Alert recipe). No margin here — call sites own placement.
export const noticeBoxOk = css`
  background: var(--haze-color-success-subtle);
  border: 1px solid color-mix(in srgb, var(--haze-color-success) 25%, transparent);
  color: var(--haze-color-success);
  padding: 10px 14px;
  border-radius: 6px;
  word-break: break-word;
`;

export const noticeBoxWarn = css`
  background: var(--haze-color-warning-subtle);
  border: 1px solid color-mix(in srgb, var(--haze-color-warning) 25%, transparent);
  color: var(--haze-color-warning);
  padding: 10px 14px;
  border-radius: 6px;
  word-break: break-word;
`;

export const noticeBoxError = css`
  background: var(--haze-color-danger-subtle);
  border: 1px solid color-mix(in srgb, var(--haze-color-danger) 25%, transparent);
  color: var(--haze-color-danger);
  padding: 10px 14px;
  border-radius: 6px;
  word-break: break-word;
`;

// Solid action buttons (the haze-ui solid recipe: role fill + inverse
// text, one step down the ladder on hover). Panels keep their own
// padding/font-size/radius next to these.
export const primaryActionButton = css`
  cursor: pointer;
  background: var(--haze-color-primary);
  border: 1px solid var(--haze-color-primary-hover);
  color: var(--haze-color-text-inverse);
  font-weight: 500;

  &:hover:not(:disabled) {
    background: var(--haze-color-primary-hover);
    border-color: var(--haze-color-primary-active);
  }

  &:disabled {
    background: var(--haze-color-primary-subtle);
    border-color: var(--haze-color-primary-subtle);
    color: var(--haze-color-text-muted);
    cursor: not-allowed;
  }
`;

// Amber twin of the primary button: the contract page's custom-ABI actions
// (paste-ABI unlock, shadow notice) carry the warning palette.
export const warningActionButton = css`
  cursor: pointer;
  background: var(--haze-color-warning);
  border: 1px solid var(--haze-color-warning-hover);
  color: var(--haze-color-text-inverse);
  font-weight: 500;

  &:hover:not(:disabled) {
    background: var(--haze-color-warning-hover);
    border-color: var(--haze-color-warning-active);
  }

  &:disabled {
    background: var(--haze-color-warning-subtle);
    border-color: var(--haze-color-warning-subtle);
    color: var(--haze-color-text-muted);
    cursor: not-allowed;
  }
`;

// Neutral gray action button for secondary submits (the bootstrap-era
// secondary gray): text-secondary fills both directions: dark-on-light in the
// light theme, light-on-dark in the dark theme, always against
// text-inverse text.
export const secondaryActionButton = css`
  cursor: pointer;
  background: var(--haze-color-text-secondary);
  border: 1px solid var(--haze-color-text-secondary);
  color: var(--haze-color-text-inverse);
  font-weight: 500;

  &:hover:not(:disabled) {
    background: var(--haze-color-text-muted);
    border-color: var(--haze-color-text-muted);
  }

  &:disabled {
    background: var(--haze-color-bg-muted);
    border-color: var(--haze-color-border);
    color: var(--haze-color-text-muted);
    cursor: not-allowed;
  }
`;

// Soft badge color recipes (the haze-ui Badge palette). Shape, padding and
// typography stay with each badge so pills and squares compose freely
// without property conflicts.
export const badgeOk = css`
  background: var(--haze-color-success-subtle);
  border: 1px solid color-mix(in srgb, var(--haze-color-success) 25%, transparent);
  color: var(--haze-color-success);
`;

export const badgeWarn = css`
  background: var(--haze-color-warning-subtle);
  border: 1px solid color-mix(in srgb, var(--haze-color-warning) 25%, transparent);
  color: var(--haze-color-warning);
`;

export const badgeError = css`
  background: var(--haze-color-danger-subtle);
  border: 1px solid color-mix(in srgb, var(--haze-color-danger) 25%, transparent);
  color: var(--haze-color-danger);
`;

export const linkStyle = css`
  color: var(--haze-color-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;
