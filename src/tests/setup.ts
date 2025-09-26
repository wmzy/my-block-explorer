import '@testing-library/jest-dom';
import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { simpleTestDb } from "./testDatabase.simple";

// Initialize test database before all tests
beforeAll(async () => {
  try {
    await simpleTestDb.initialize();
  } catch (error) {
    console.warn("Failed to initialize test database:", error);
  }
});

// Clean up test database after all tests
afterAll(async () => {
  try {
    await simpleTestDb.close();
  } catch (error) {
    console.warn("Failed to close test database:", error);
  }
});

// Clear test data before each test
beforeEach(async () => {
  try {
    await simpleTestDb.clearAllData();
  } catch (error) {
    console.warn("Failed to clear test data:", error);
  }
});

// Mock window.matchMedia for responsive design tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
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
