import { css } from "@linaria/core";

export const globalStyles = css`
  :global() {
    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      font-family:
        -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen",
        "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue",
        sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      line-height: 1.5;
    }

    body {
      background-color: #f8fafc;
      color: #1e293b;
    }

    #root {
      min-height: 100vh;
    }

    a {
      color: #3b82f6;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    code {
      font-family:
        "JetBrains Mono", "Fira Code", "Consolas", "Monaco", monospace;
      background-color: #f1f5f9;
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 0.875em;
    }

    pre {
      background-color: #f1f5f9;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-family:
        "JetBrains Mono", "Fira Code", "Consolas", "Monaco", monospace;
    }

    pre code {
      background: none;
      padding: 0;
    }

    /* 深色模式 */
    @media (prefers-color-scheme: dark) {
      body {
        background-color: #0f172a;
        color: #e2e8f0;
      }

      code {
        background-color: #1e293b;
        color: #e2e8f0;
      }

      pre {
        background-color: #1e293b;
      }
    }

    /* 滚动条样式 */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-track {
      background: #f1f5f9;
    }

    ::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }

    @media (prefers-color-scheme: dark) {
      ::-webkit-scrollbar-track {
        background: #1e293b;
      }

      ::-webkit-scrollbar-thumb {
        background: #475569;
      }

      ::-webkit-scrollbar-thumb:hover {
        background: #64748b;
      }
    }

    /* 响应式断点 */
    .container {
      width: 100%;
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 16px;
    }

    @media (min-width: 640px) {
      .container {
        padding: 0 24px;
      }
    }

    @media (min-width: 1024px) {
      .container {
        padding: 0 32px;
      }
    }

    /* 实用工具类 */
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
      font-family:
        "JetBrains Mono", "Fira Code", "Consolas", "Monaco", monospace;
    }
  }
`;
