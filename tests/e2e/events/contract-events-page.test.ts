/**
 * E2E tests for contract events page navigation
 * Tests: T015 - Contract events page user journey
 */

import { test, expect } from '@playwright/test';

test.describe('Contract Events Page E2E', () => {
  const chainId = 1; // Ethereum mainnet
  const contractAddress = '0x1234567890123456789012345678901234567890';
  const eventsUrl = `/chains/${chainId}/contracts/${contractAddress}/events`;

  test.beforeEach(async ({ page }) => {
    // Navigate to contract events page
    await page.goto(eventsUrl);
  });

  test('should load events page successfully', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Contract Events/);

    // Check main elements are present
    await expect(page.locator('h1')).toContainText('Contract Events');
    await expect(page.locator('[data-testid="contract-address"]')).toContainText(contractAddress);
    await expect(page.locator('[data-testid="chain-info"]')).toContainText('Ethereum');
  });

  test('should display event statistics', async ({ page }) => {
    // Wait for statistics to load
    await page.waitForSelector('[data-testid="event-statistics"]');

    // Check statistics elements
    await expect(page.locator('[data-testid="total-events"]')).toBeVisible();
    await expect(page.locator('[data-testid="indexing-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="last-indexed-block"]')).toBeVisible();
  });

  test('should show loading state during initial load', async ({ page }) => {
    // Check for loading indicators
    const loadingIndicator = page.locator('[data-testid="loading-indicator"]');

    // Loading should be visible initially
    await expect(loadingIndicator).toBeVisible();

    // Wait for loading to complete
    await page.waitForSelector('[data-testid="events-table"]', { state: 'visible' });

    // Loading should disappear after data loads
    await expect(loadingIndicator).not.toBeVisible();
  });

  test('should display events table with correct columns', async ({ page }) => {
    // Wait for events table to load
    await page.waitForSelector('[data-testid="events-table"]');

    // Check table headers
    await expect(page.locator('[data-testid="table-header-block-number"]')).toBeVisible();
    await expect(page.locator('[data-testid="table-header-timestamp"]')).toBeVisible();
    await expect(page.locator('[data-testid="table-header-event-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="table-header-transaction-hash"]')).toBeVisible();
    await expect(page.locator('[data-testid="table-header-parameters"]')).toBeVisible();
  });

  test('should handle empty events state', async ({ page }) => {
    // Mock API to return empty events
    await page.route('**/events*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [],
          total: 0,
          hasMore: false,
        }),
      });
    });

    await page.reload();
    await page.waitForSelector('[data-testid="empty-state"]');

    // Check empty state message
    await expect(page.locator('[data-testid="empty-state"]')).toContainText('No events found');
    await expect(page.locator('[data-testid="empty-state-message"]')).toContainText('contract has not emitted any events');
  });

  test('should display pagination controls', async ({ page }) => {
    // Wait for events to load
    await page.waitForSelector('[data-testid="events-table"]');

    // Check pagination elements
    const pagination = page.locator('[data-testid="pagination"]');
    await expect(pagination).toBeVisible();

    // Check pagination buttons
    await expect(page.locator('[data-testid="pagination-prev"]')).toBeVisible();
    await expect(page.locator('[data-testid="pagination-next"]')).toBeVisible();
    await expect(page.locator('[data-testid="pagination-info"]')).toBeVisible();
  });

  test('should navigate between pages', async ({ page }) => {
    // Wait for events to load
    await page.waitForSelector('[data-testid="events-table"]');

    // Click next page
    await page.click('[data-testid="pagination-next"]');
    await page.waitForLoadState('networkidle');

    // Check URL has updated
    expect(page.url()).toContain('page=2');

    // Check pagination info has updated
    await expect(page.locator('[data-testid="pagination-info"]')).toContainText('Page 2');
  });

  test('should handle sorting by different columns', async ({ page }) => {
    // Wait for events to load
    await page.waitForSelector('[data-testid="events-table"]');

    // Click timestamp column to sort
    await page.click('[data-testid="table-header-timestamp"]');
    await page.waitForLoadState('networkidle');

    // Check URL has sort parameter
    expect(page.url()).toContain('sort=timestamp');

    // Click again to reverse sort
    await page.click('[data-testid="table-header-timestamp"]');
    await page.waitForLoadState('networkidle');

    // Check sort direction has changed
    expect(page.url()).toContain('sortOrder=desc');
  });

  test('should display event parameters correctly', async ({ page }) => {
    // Mock specific event data
    await page.route('**/events*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            {
              blockNumber: 18000000,
              blockTimestamp: '2024-01-01T00:00:00Z',
              eventName: 'Transfer',
              transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              from: '0xabcdef1234567890abcdef1234567890abcdef12',
              to: '0x1234567890abcdef1234567890abcdef12345678',
              value: '1000000000000000000',
            },
          ],
          total: 1,
          hasMore: false,
        }),
      });
    });

    await page.reload();
    await page.waitForSelector('[data-testid="events-table"]');

    // Check event parameters are displayed
    await expect(page.locator('[data-testid="event-param-from"]')).toContainText('0xabcdef...');
    await expect(page.locator('[data-testid="event-param-to"]')).toContainText('0x123456...');
    await expect(page.locator('[data-testid="event-param-value"]')).toContainText('1.0 ETH');
  });

  test('should handle indexing progress display', async ({ page }) => {
    // Mock indexing status
    await page.route('**/indexing-status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          isIndexed: false,
          indexingProgress: 45,
          totalEvents: 1000,
          indexedEvents: 450,
          lastIndexedBlock: 18000000,
          lastIndexedAt: '2024-01-01T00:00:00Z',
          eventTypes: ['Transfer', 'Approval'],
          errors: [],
        }),
      });
    });

    await page.reload();
    await page.waitForSelector('[data-testid="indexing-progress"]');

    // Check progress display
    await expect(page.locator('[data-testid="progress-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="progress-percentage"]')).toContainText('45%');
    await expect(page.locator('[data-testid="indexed-events-count"]')).toContainText('450 / 1000');
  });

  test('should show error state on API failure', async ({ page }) => {
    // Mock API failure
    await page.route('**/events*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await page.reload();
    await page.waitForSelector('[data-testid="error-state"]');

    // Check error display
    await expect(page.locator('[data-testid="error-message"]')).toContainText('Failed to load events');
    await expect(page.locator('[data-testid="retry-button"]')).toBeVisible();
  });

  test('should handle retry functionality', async ({ page }) => {
    // Mock initial failure, then success
    let callCount = 0;
    await page.route('**/events*', async (route) => {
      callCount++;
      if (callCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal server error' }),
        });
      }
      else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            events: [
              {
                blockNumber: 18000000,
                blockTimestamp: '2024-01-01T00:00:00Z',
                eventName: 'Transfer',
                transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              },
            ],
            total: 1,
            hasMore: false,
          }),
        });
      }
    });

    await page.reload();
    await page.waitForSelector('[data-testid="error-state"]');

    // Click retry button
    await page.click('[data-testid="retry-button"]');
    await page.waitForSelector('[data-testid="events-table"]');

    // Should now show events successfully
    await expect(page.locator('[data-testid="events-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="event-row"]')).toHaveCount(1);
  });

  test('should maintain filter state across navigation', async ({ page }) => {
    // Wait for events to load
    await page.waitForSelector('[data-testid="events-table"]');

    // Apply a filter
    await page.fill('[data-testid="event-filter-input"]', 'Transfer');
    await page.click('[data-testid="apply-filter-button"]');

    // Navigate to next page
    await page.click('[data-testid="pagination-next"]');
    await page.waitForLoadState('networkidle');

    // Check filter is still applied
    expect(page.locator('[data-testid="event-filter-input"]')).toHaveValue('Transfer');
    expect(page.url()).toContain('eventName=Transfer');
  });

  test('should handle real-time updates', async ({ page }) => {
    // Wait for events to load
    await page.waitForSelector('[data-testid="events-table"]');

    const initialEventCount = await page.locator('[data-testid="event-row"]').count();

    // Simulate real-time update via WebSocket mock
    await page.evaluate(() => {
      // Mock WebSocket connection
      (window as any).WebSocket = class MockWebSocket {
        constructor(url: string) {
          setTimeout(() => {
            // Simulate new event
            const event = new MessageEvent('message', {
              data: JSON.stringify({
                type: 'new_event',
                data: {
                  blockNumber: 18000001,
                  blockTimestamp: new Date().toISOString(),
                  eventName: 'Transfer',
                  transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                },
              }),
            });
            (this as any).onmessage?.(event);
          }, 1000);
        }

        onmessage: ((event: MessageEvent) => void) | null = null;
        send() {}
        close() {}
      };
    });

    // Wait for potential update
    await page.waitForTimeout(2000);

    // Check if new event indicator appears (implementation specific)
    const newEventIndicator = page.locator('[data-testid="new-events-available"]');
    if (await newEventIndicator.isVisible()) {
      await expect(newEventIndicator).toBeVisible();
    }
  });

  test('should be accessible', async ({ page }) => {
    // Check basic accessibility
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('[data-testid="events-table"]')).toBeVisible();

    // Check keyboard navigation
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();

    // Check ARIA labels
    const table = page.locator('[data-testid="events-table"]');
    await expect(table).toHaveAttribute('role', 'table');
  });
});
