import { expect, afterEach, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { simpleTestDb } from './testDatabase';
import React from 'react';

expect.extend(matchers);

type MockProps = Record<string, unknown> & { children?: React.ReactNode };

const mockComponent = (tag: string, props: MockProps, extraProps?: Record<string, unknown>) => {
  const { children, ...rest } = props;
  return React.createElement(tag, { ...rest, ...extraProps }, children);
};

// Mock haze-ui to avoid babel-runtime-jsx-plus/classnames import error
vi.mock('haze-ui', () => ({
  __esModule: true,
  lightTheme: {},
  spacing: {},
  typography: {},
  ToastContainer: () => null,
  Input: (props: MockProps) =>
    React.createElement('input', {
      'data-testid': 'search-input',
      'placeholder': props.placeholder as string,
      ...props,
    }),
  Button: (props: MockProps) =>
    React.createElement('button', {
      'data-testid': 'search-button',
      ...props,
    }),
  Dialog: (props: MockProps) =>
    props.open
      ? React.createElement(
          'div',
          { 'data-testid': 'dialog', 'role': 'dialog', 'aria-modal': 'true' },
          [
            React.createElement(
              'div',
              { 'data-testid': 'dialog-title' },
              props.title as React.ReactNode,
            ),
            React.createElement(
              'button',
              { 'data-testid': 'dialog-close', 'onClick': props.onClose },
              '×',
            ),
            props.children,
          ],
        )
      : null,
  Skeleton: (props: MockProps) => mockComponent('div', props, { 'data-testid': 'skeleton' }),
  Badge: (props: MockProps) =>
    mockComponent('span', props, { 'data-testid': 'badge', 'data-variant': props.variant }),
  Tag: (props: MockProps) => mockComponent('span', props, { 'data-testid': 'tag' }),
  Card: (props: MockProps) => mockComponent('div', props, { 'data-testid': 'card' }),
  Alert: (props: MockProps) =>
    mockComponent('div', props, { 'data-testid': 'alert', 'data-type': props.type }),
  Tooltip: (props: MockProps) =>
    mockComponent('div', props, { 'data-testid': 'tooltip', 'title': props.content }),
  Dropdown: (props: MockProps) =>
    React.createElement('div', { 'data-testid': 'dropdown' }, [
      React.createElement(
        'div',
        { 'data-testid': 'dropdown-trigger' },
        props.trigger as React.ReactNode,
      ),
      props.children,
    ]),
  Select: (props: MockProps) =>
    React.createElement(
      'select',
      { 'data-testid': 'select', ...props },
      (props.placeholder &&
        React.createElement(
          'option',
          { value: '' },
          props.placeholder as React.ReactNode,
        )) as React.ReactNode,
      props.children,
    ),
  Option: (props: MockProps) =>
    React.createElement('option', { value: props.value as string, ...props }, props.children),
  Table: (props: MockProps) => mockComponent('table', props, { 'data-testid': 'table' }),
  TableHeader: (props: MockProps) =>
    mockComponent('thead', props, { 'data-testid': 'table-header' }),
  TableBody: (props: MockProps) => mockComponent('tbody', props, { 'data-testid': 'table-body' }),
  TableRow: (props: MockProps) => mockComponent('tr', props, { 'data-testid': 'table-row' }),
  TableCell: (props: MockProps) => mockComponent('td', props, { 'data-testid': 'table-cell' }),
  Pagination: (props: MockProps) => {
    const currentPage = props.currentPage as number;
    const totalPages = props.totalPages as number;
    return React.createElement(
      'div',
      {
        'data-testid': 'pagination',
        'data-page': currentPage,
        'data-total': totalPages,
        ...props,
      },
      [
        React.createElement(
          'button',
          {
            'data-testid': 'prev-page',
            'onClick': () => (props.onChange as (page: number) => void)?.(currentPage - 1),
            'disabled': currentPage <= 1,
          },
          'Previous',
        ),
        React.createElement(
          'span',
          { 'data-testid': 'page-info' },
          `Page ${currentPage} of ${totalPages}`,
        ),
        React.createElement(
          'button',
          {
            'data-testid': 'next-page',
            'onClick': () => (props.onChange as (page: number) => void)?.(currentPage + 1),
            'disabled': currentPage >= totalPages,
          },
          'Next',
        ),
      ],
    );
  },
  Spin: (props: MockProps) => mockComponent('div', props, { 'data-testid': 'spin' }),
  Divider: (props: MockProps) => mockComponent('hr', props, { 'data-testid': 'divider' }),
  Text: (props: MockProps) => React.createElement('span', props, props.children),
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
