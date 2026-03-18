import { css } from "@linaria/core";

export const hazeThemeWrapper = css`
  @media (prefers-color-scheme: dark) {
    --haze-color-primary: #4d94ff;
    --haze-color-primary-hover: #6aa6ff;
    --haze-color-primary-active: #80b3ff;
    --haze-color-primary-subtle: #1a2e4a;
    --haze-color-bg: #121212;
    --haze-color-bg-subtle: #1e1e1e;
    --haze-color-bg-muted: #2a2a2a;
    --haze-color-text: #e8e8e8;
    --haze-color-text-secondary: #b0b0b0;
    --haze-color-text-muted: #707070;
    --haze-color-text-inverse: #1a1a1a;
    --haze-color-border: #333;
    --haze-color-border-hover: #4a4a4a;
    --haze-color-success: #22c55e;
    --haze-color-warning: #fbbf24;
    --haze-color-danger: #ef4444;
    --haze-color-info: #3b82f6;
    --haze-color-focus-ring: #4d94ff66;
  }
`;

export const globalStyles = css`
  :global() {
    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      font-family: var(--haze-font-sans);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      line-height: var(--haze-leading-normal);
    }

    body {
      background-color: var(--haze-color-bg);
      color: var(--haze-color-text);
    }

    #root {
      min-height: 100vh;
    }

    a {
      color: var(--haze-color-primary);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    code {
      font-family: var(--haze-font-mono);
      background-color: var(--haze-color-bg-muted);
      padding: 2px 4px;
      border-radius: var(--haze-radius-sm);
      font-size: 0.875em;
    }

    pre {
      background-color: var(--haze-color-bg-muted);
      padding: var(--haze-space-4);
      border-radius: var(--haze-radius-lg);
      overflow-x: auto;
      font-family: var(--haze-font-mono);
    }

    pre code {
      background: none;
      padding: 0;
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-track {
      background: var(--haze-color-bg-subtle);
    }

    ::-webkit-scrollbar-thumb {
      background: var(--haze-color-border);
      border-radius: var(--haze-radius-sm);
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--haze-color-border-hover);
    }

    /* Responsive container */
    .container {
      width: 100%;
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 var(--haze-space-4);
    }

    @media (min-width: 640px) {
      .container {
        padding: 0 var(--haze-space-6);
      }
    }

    @media (min-width: 1024px) {
      .container {
        padding: 0 var(--haze-space-8);
      }
    }

    /* Utility classes */
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .break-all {
      word-break: break-all;
    }

    .font-mono {
      font-family: var(--haze-font-mono);
    }
  }
`;
