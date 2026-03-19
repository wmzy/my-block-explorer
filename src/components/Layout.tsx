import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { css, cx } from '@linaria/core';

const layout = css`
  display: flex;
  flex-direction: column;
  min-height: 100vh;
`;

const header = css`
  background-color: white;
  border-bottom: 1px solid #e2e8f0;
  padding: 16px 0;
  
  @media (prefers-color-scheme: dark) {
    background-color: #1e293b;
    border-bottom-color: #334155;
  }
`;

const nav = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 16px;
  
  @media (min-width: 640px) {
    padding: 0 24px;
  }
`;

const logo = css`
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
  text-decoration: none;
  
  &:hover {
    text-decoration: none;
  }
  
  @media (prefers-color-scheme: dark) {
    color: #e2e8f0;
  }
`;

const navLinks = css`
  display: flex;
  align-items: center;
  gap: 32px;
`;

const navLink = css`
  color: #64748b;
  text-decoration: none;
  font-weight: 500;
  padding: 8px 0;
  transition: color 0.15s ease;
  
  &:hover {
    color: #3b82f6;
    text-decoration: none;
  }
  
  &.active {
    color: #3b82f6;
    border-bottom: 2px solid #3b82f6;
  }
  
  @media (prefers-color-scheme: dark) {
    color: #94a3b8;
    
    &:hover {
      color: #60a5fa;
    }
    
    &.active {
      color: #60a5fa;
      border-bottom-color: #60a5fa;
    }
  }
`;

const main = css`
  flex: 1;
  padding: 32px 0;
`;

const container = css`
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 16px;
  
  @media (min-width: 640px) {
    padding: 0 24px;
  }
`;

const footer = css`
  background-color: #f8fafc;
  border-top: 1px solid #e2e8f0;
  padding: 24px 0;
  margin-top: auto;
  
  @media (prefers-color-scheme: dark) {
    background-color: #0f172a;
    border-top-color: #334155;
  }
`;

const footerContent = css`
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 16px;
  text-align: center;
  color: #64748b;
  font-size: 14px;
  
  @media (min-width: 640px) {
    padding: 0 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  @media (prefers-color-scheme: dark) {
    color: #94a3b8;
  }
`;

export type LayoutProps = {
  children: React.ReactNode;
};

export function Layout({ children }: LayoutProps) {
  const location = useLocation();

  const isActiveLink = (path: string) => {
    if (path === '/' && location.pathname === '/') return true;
    if (path !== '/' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <div className={layout}>
      <header className={header}>
        <nav className={nav}>
          <Link to="/" className={logo}>
            Block Explorer
          </Link>

          <div className={navLinks}>
            <Link
              to="/"
              className={cx(navLink, isActiveLink('/') && 'active')}
            >
              首页
            </Link>
            <Link
              to="/search"
              className={cx(navLink, isActiveLink('/search') && 'active')}
            >
              搜索
            </Link>
          </div>
        </nav>
      </header>

      <main className={main}>
        <div className={container}>
          {children}
        </div>
      </main>

      <footer className={footer}>
        <div className={footerContent}>
          <div>
            © 2024 Block Explorer. 基于 DuckDB 和 Viem 构建。
          </div>
          <div className={css`margin-top: 8px; @media (min-width: 640px) { margin-top: 0; }`}>
            <a
              href="/api"
              target="_blank"
              rel="noopener noreferrer"
              className={css`color: #3b82f6; text-decoration: none; &:hover { text-decoration: underline; }`}
            >
              API 文档
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
