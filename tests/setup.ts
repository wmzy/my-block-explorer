import { expect, afterEach, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { simpleTestDb } from './testDatabase';
import React from 'react';

// Extend expect matchers
expect.extend(matchers);

// Mock haze-ui to avoid babel-runtime-jsx-plus/classnames import error
vi.mock('haze-ui', () => ({
  __esModule: true,
  lightTheme: {},
  spacing: {},
  typography: {},
  ToastContainer: () => null,
  Input: (props: Record<string, unknown>) =>
    React.createElement('input', {
      'data-testid': 'search-input',
      placeholder: props.placeholder as string,
      ...props,
    }),
  Button: (props: Record<string, unknown>) =>
    React.createElement('button', {
      'data-testid': 'search-button',
      ...props,
    }),
  Dialog: (props: Record<string, unknown>) =>
    props.open
      ? React.createElement(
          'div',
          { 'data-testid': 'dialog', role: 'dialog', 'aria-modal': 'true' },
          [
            React.createElement('div', { 'data-testid': 'dialog-title' }, props.title),
            React.createElement(
              'button',
              { 'data-testid': 'dialog-close', onClick: props.onClose },
              '×',
            ),
            props.children,
          ],
        )
      : null,
  Skeleton: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'skeleton', ...props }),
  Badge: (props: Record<string, unknown>) =>
    React.createElement(
      'span',
      { 'data-testid': 'badge', 'data-variant': props.variant, ...props },
      props.children,
    ),
  Tag: (props: Record<string, unknown>) =>
    React.createElement('span', { 'data-testid': 'tag', ...props }, props.children),
  Card: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'card', ...props }, props.children),
  Alert: (props: Record<string, unknown>) =>
    React.createElement(
      'div',
      { 'data-testid': 'alert', 'data-type': props.type, ...props },
      props.children,
    ),
  Tooltip: (props: Record<string, unknown>) =>
    React.createElement(
      'div',
      { 'data-testid': 'tooltip', title: props.content, ...props },
      props.children,
    ),
  Dropdown: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'dropdown' }, [
      React.createElement('div', { 'data-testid': 'dropdown-trigger' }, props.trigger),
      React.createElement('div', { 'data-testid': 'dropdown-content' }, props.children),
    ]),
  Select: (props: Record<string, unknown>) =>
    React.createElement(
      'select',
      { 'data-testid': 'select', ...props },
      props.placeholder && React.createElement('option', { value: '' }, props.placeholder),
      props.children,
    ),
  Option: (props: Record<string, unknown>) =>
    React.createElement('option', { value: props.value as string, ...props }, props.children),
  Table: (props: Record<string, unknown>) =>
    React.createElement('table', { 'data-testid': 'table', ...props }, props.children),
  TableHeader: (props: Record<string, unknown>) =>
    React.createElement('thead', { 'data-testid': 'table-header', ...props }, props.children),
  TableBody: (props: Record<string, unknown>) =>
    React.createElement('tbody', { 'data-testid': 'table-body', ...props }, props.children),
  TableRow: (props: Record<string, unknown>) =>
    React.createElement('tr', { 'data-testid': 'table-row', ...props }, props.children),
  TableCell: (props: Record<string, unknown>) =>
    React.createElement('td', { 'data-testid': 'table-cell', ...props }, props.children),
  Pagination: (props: Record<string, unknown>) =>
    React.createElement(
      'div',
      {
        'data-testid': 'pagination',
        'data-page': props.currentPage,
        'data-total': props.totalPages,
        ...props,
      },
      [
        React.createElement(
          'button',
          {
            'data-testid': 'prev-page',
            onClick: () => props.onChange?.((props.currentPage as number) - 1),
            disabled: (props.currentPage as number) <= 1,
          },
          'Previous',
        ),
        React.createElement(
          'span',
          { 'data-testid': 'page-info' },
          `Page ${props.currentPage} of ${props.totalPages}`,
        ),
        React.createElement(
          'button',
          {
            'data-testid': 'next-page',
            onClick: () => props.onChange?.((props.currentPage as number) + 1),
            disabled: (props.currentPage as number) >= (props.totalPages as number),
          },
          'Next',
        ),
      ],
    ),
  Spin: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'spin', ...props }, props.children),
  Divider: (props: Record<string, unknown>) =>
    React.createElement('hr', { 'data-testid': 'divider', ...props }),
  Text: (props: Record<string, unknown>) => React.createElement('span', props, props.children),
  useToast: () => ({ addToast: vi.fn() }),
}));

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Initialize test database before all tests
beforeAll(async () => {
  try {
    await simpleTestDb.initialize();
  } catch (error) {
    console.warn('Failed to initialize test database:', error);
  }
});

// Clean up test database after all tests
afterAll(async () => {
  try {
    await simpleTestDb.close();
  } catch (error) {
    console.warn('Failed to close test database:', error);
  }
});

// Clear test data before each test
beforeEach(async () => {
  try {
    await simpleTestDb.clearAllData();
  } catch (error) {
    console.warn('Failed to clear test data:', error);
  }
});

// Mock window.matchMedia for responsive design tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock scrollTo
window.scrollTo = vi.fn();

// Mock fetch for API tests
global.fetch = vi.fn();

// Mock console methods to reduce test noise
const originalConsole = { ...console };
beforeEach(() => {
  console.warn = vi.fn();
  console.error = vi.fn();
});

afterEach(() => {
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});
