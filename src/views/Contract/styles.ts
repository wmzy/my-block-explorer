import { css } from '@linaria/core';

// Styles shared by the view shell and the tab panels; panel-specific styles
// stay colocated with their components.
export const cardStyles = css`
  background: white;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 20px;

  h2 {
    font-size: 18px;
    margin: 0 0 16px 0;
    color: #1a1a1a;
  }
`;

export const loadingStyles = css`
  text-align: center;
  padding: 40px;
  color: #666;
`;

export const errorStyles = css`
  background: #f8d7da;
  color: #721c24;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 20px;
`;
