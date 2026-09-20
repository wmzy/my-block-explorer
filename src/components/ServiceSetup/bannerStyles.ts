// Shared Linaria styles for the fixed top warning strips of the service
// discovery gate (DegradedModeBanner, SwitchedBackendBanner). One source
// keeps the family visually identical by construction; new gate banners
// must consume these instead of forking their own copies.
import { css } from '@linaria/core';

export const bannerStyle = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--haze-space-3) var(--haze-space-4);
  padding: var(--haze-space-3) var(--haze-space-10);
  background: var(--haze-color-warning-subtle, #fef3c7);
  border-bottom: 1px solid var(--haze-color-warning, #d97706);
  color: var(--haze-color-text);
  box-shadow: var(--haze-shadow-md);
`;

export const bannerMessageStyle = css`
  font-size: var(--haze-text-sm);
  line-height: var(--haze-leading-relaxed);
  color: var(--haze-color-text);
`;

export const bannerDismissStyle = css`
  position: absolute;
  top: 50%;
  right: var(--haze-space-3);
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--haze-radius-sm);
  background: transparent;
  color: var(--haze-color-text-secondary);
  font-size: var(--haze-text-lg);
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text);
  }
`;
