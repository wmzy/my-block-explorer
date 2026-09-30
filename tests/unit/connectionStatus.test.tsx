// ConnectionStatus badge/panel contract:
//
//  - the fixed bottom-left badge toggles an expanded details panel
//    (status/URL/version + Disconnect);
//  - a mousedown OUTSIDE the badge+panel container closes the panel
//    (click-blank auto-close — same document-mousedown pattern as
//    TopNavigation's dropdowns and OpenInIdeButton);
//  - a mousedown INSIDE the panel leaves it open (clicking rows must
//    not dismiss);
//  - clicking the badge itself still toggles (mousedown on the badge is
//    inside the container, so the outside handler must not race the
//    toggle into a no-op).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConnectionStatus } from '@/components/ServiceSetup/ConnectionStatus';

// Module-mutable discovery state (gettingStarted.test.tsx pattern): the
// factory reads it lazily, each case pins what the badge observes.
const discovery = vi.hoisted(() => ({
  status: 'found',
  serviceInfo: {
    host: '127.0.0.1',
    port: 8201,
    url: 'http://127.0.0.1:8201',
    version: '1.2.0',
  },
  isConnected: true,
  isScanning: false,
  disconnect: vi.fn(),
  reconnect: vi.fn(async () => null),
}));

vi.mock('@/hooks/ServiceDiscoveryContext', () => ({
  useServiceDiscovery: () => discovery,
}));

const badge = () => screen.getByRole('button', { name: 'Connected' });

const openPanel = () => {
  fireEvent.click(badge());
  return screen.getByText('http://127.0.0.1:8201');
};

describe('ConnectionStatus panel dismissal', () => {
  it('shows no panel until the badge is clicked', () => {
    render(<ConnectionStatus />);
    expect(screen.getByText('Connected')).toBeVisible();
    expect(screen.queryByText('URL')).not.toBeInTheDocument();
  });

  it('closes the expanded panel on mousedown outside (click blank)', () => {
    render(<ConnectionStatus />);
    openPanel();
    expect(screen.getByText('URL')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('URL')).not.toBeInTheDocument();
  });

  it('keeps the panel open on mousedown inside it', () => {
    render(<ConnectionStatus />);
    openPanel();

    fireEvent.mouseDown(screen.getByText('URL'));
    expect(screen.getByText('URL')).toBeInTheDocument();
  });

  it('still toggles the panel via the badge while open', () => {
    render(<ConnectionStatus />);
    fireEvent.click(badge());
    expect(screen.getByText('URL')).toBeInTheDocument();

    // mousedown lands on the badge (inside the container) first, then the
    // click toggles — the panel must end up closed exactly once, not
    // double-handled.
    fireEvent.mouseDown(badge());
    fireEvent.click(badge());
    expect(screen.queryByText('URL')).not.toBeInTheDocument();

    // And it can be reopened afterwards.
    openPanel();
    expect(screen.getByText('URL')).toBeInTheDocument();
  });
});
