// Entry-gate contract for service discovery:
//
//  - SetupRequiredScreen mixed-content honesty: on HTTPS-hosted deployments
//    (e.g. the GitHub Pages demo) browsers may block the automatic localhost
//    port scan, so the setup screen must explain why "no service detected"
//    can be a false negative — but only on HTTPS pages, never on HTTP.
//  - DiscoveryGate degraded mode: when every probe fails the app still
//    renders with a dismissible banner; "Open setup" reveals the setup
//    screen as an overlay; connecting mid-session (manual URL) removes
//    banner + overlay without remounting the app.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ComponentProps, ReactNode } from 'react';
import { SetupRequiredScreen } from '@/components/ServiceSetup/SetupRequiredScreen';
import { DiscoveryGate } from '@/components/ServiceSetup/DiscoveryGate';

const BANNER_TEXT =
  'Backend not found — indexed data (contracts, events, search suggestions) unavailable.';

type ScreenProps = ComponentProps<typeof SetupRequiredScreen>;

function renderScreen(props: Partial<ScreenProps> = {}) {
  const defaultProps: ScreenProps = {
    error: null,
    isConnecting: false,
    onSetApiUrl: vi.fn().mockResolvedValue(true),
    onDiscover: vi.fn(),
  };
  return render(<SetupRequiredScreen {...defaultProps} {...props} />);
}

type GateProps = ComponentProps<typeof DiscoveryGate>;

function renderGate(overrides: Partial<GateProps> = {}, children?: ReactNode) {
  const setApiUrl = overrides.setApiUrl ?? vi.fn().mockResolvedValue(true);
  const discover = overrides.discover ?? vi.fn();
  const props: GateProps = {
    status: 'not-found',
    error: null,
    isScanning: false,
    setApiUrl,
    discover,
    children: children ?? <div data-testid="app-content">RPC-only app</div>,
    ...overrides,
    // children goes through the argument, not the overrides spread
  };
  const view = render(<DiscoveryGate {...props} />);
  return { ...view, setApiUrl, discover, props };
}

function storageKeys() {
  return {
    local: Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)),
    session: Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)),
  };
}

describe('SetupRequiredScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('HTTPS mixed-content explainer', () => {
    it('is hidden on a plain HTTP page (default jsdom location)', () => {
      renderScreen();

      expect(screen.queryByText(/served over HTTPS/)).toBeNull();
      // Zero behavior change on HTTP: the regular setup screen is intact.
      expect(
        screen.getByRole('heading', { name: 'Block Explorer Setup' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Install Local Service' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Connect to Remote API' }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('API URL')).toBeInTheDocument();
    });

    it('is hidden when the page is explicitly not HTTPS', () => {
      renderScreen({ isHttpsPage: false });

      expect(screen.queryByText(/served over HTTPS/)).toBeNull();
    });

    it('explains the browser-blocked local-port scan on HTTPS pages', () => {
      renderScreen({ isHttpsPage: true });

      const explainer = screen.getByText(/served over HTTPS/);
      expect(explainer).toHaveTextContent('automatic scan of local ports may be');
      expect(explainer).toHaveTextContent('this varies by browser; Safari blocks it');
      expect(explainer).toHaveTextContent('usually works in Chrome and Firefox');
      expect(explainer).toHaveTextContent('run the frontend locally instead');
      expect(screen.getByText('http://localhost:8201')).toBeInTheDocument();
      expect(screen.getByText('pnpm dev')).toBeInTheDocument();
    });
  });

  describe('as a setup overlay (onClose)', () => {
    it('renders a back escape only when a close handler is given', async () => {
      const onClose = vi.fn();
      renderScreen({ onClose });
      expect(
        screen.getByRole('button', { name: /Back to explorer/ }),
      ).toBeInTheDocument();
    });

    it('has no back escape in full-page gate mode', () => {
      renderScreen();
      expect(screen.queryByRole('button', { name: /Back to explorer/ })).toBeNull();
    });
  });

  describe('automatic re-probe while open', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('re-probes discovery on an interval and stops on unmount', async () => {
      const onDiscover = vi.fn();
      const { unmount } = renderScreen({ onDiscover });

      // The first re-probe waits for a full interval, not mount.
      await act(async () => {
        vi.advanceTimersByTime(3999);
      });
      expect(onDiscover).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(onDiscover).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(4000);
      });
      expect(onDiscover).toHaveBeenCalledTimes(2);

      unmount();
      await act(async () => {
        vi.advanceTimersByTime(20000);
      });
      expect(onDiscover).toHaveBeenCalledTimes(2);
    });

    it('skips the interval re-probe while a discovery round is in flight', async () => {
      const onDiscover = vi.fn();
      const baseProps = {
        error: null,
        isConnecting: true,
        onSetApiUrl: vi.fn().mockResolvedValue(true),
        onDiscover,
      } satisfies ScreenProps;
      const { rerender } = render(<SetupRequiredScreen {...baseProps} />);

      await act(async () => {
        vi.advanceTimersByTime(12000);
      });
      expect(onDiscover).not.toHaveBeenCalled();

      // The guard reads the CURRENT prop, so a later round fires again.
      rerender(<SetupRequiredScreen {...baseProps} isConnecting={false} />);
      await act(async () => {
        vi.advanceTimersByTime(4000);
      });
      expect(onDiscover).toHaveBeenCalledTimes(1);
    });

    it('keeps the manual Refresh button working alongside the interval', async () => {
      const onDiscover = vi.fn();
      renderScreen({ onDiscover });

      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(onDiscover).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(4000);
      });
      expect(onDiscover).toHaveBeenCalledTimes(2);
    });
  });
});

describe('DiscoveryGate degraded mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('renders the app with the degraded banner when every probe failed', () => {
    renderGate({ status: 'not-found' });

    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open setup' })).toBeInTheDocument();
    // No full-page setup wall: the gate itself renders nothing else.
    expect(
      screen.queryByRole('heading', { name: 'Block Explorer Setup' }),
    ).toBeNull();
  });

  it('also degrades (instead of blanking) on discovery errors', () => {
    renderGate({ status: 'error', error: 'boom' });

    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('dismissal hides the banner for the session and persists nothing', () => {
    const before = storageKeys();
    renderGate({ status: 'not-found' });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    // In-memory only: nothing written to web storage, so a reload
    // necessarily shows the banner again.
    expect(storageKeys()).toEqual(before);
    // The app keeps running behind the dismissed banner.
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('gates the first run behind the scanning screen, then degrades', () => {
    const children = <div data-testid="app-content" />;
    const { rerender } = renderGate({ status: 'discovering' }, children);

    expect(screen.getByText('Scanning for local services...')).toBeInTheDocument();
    expect(screen.getByText('Checking ports 8201–8205 in parallel')).toBeInTheDocument();
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();

    rerender(
      <DiscoveryGate
        status="not-found"
        error={null}
        isScanning={false}
        setApiUrl={vi.fn()}
        discover={vi.fn()}
      >
        {children}
      </DiscoveryGate>,
    );

    expect(screen.queryByText('Scanning for local services...')).toBeNull();
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('a mid-session retry keeps the app mounted instead of re-gating', () => {
    const children = <div data-testid="app-content" />;
    const { rerender } = renderGate({ status: 'not-found' }, children);
    const discover = vi.fn();

    rerender(
      <DiscoveryGate
        status="discovering"
        error={null}
        isScanning
        setApiUrl={vi.fn()}
        discover={discover}
      >
        {children}
      </DiscoveryGate>,
    );

    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.queryByText('Scanning for local services...')).toBeNull();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('Open setup reveals the setup overlay on top of the running app', () => {
    renderGate({ status: 'not-found' });

    fireEvent.click(screen.getByRole('button', { name: 'Open setup' }));

    expect(
      screen.getByRole('heading', { name: 'Block Explorer Setup' }),
    ).toBeInTheDocument();
    // Reused setup copy: install instructions + manual URL form + retry.
    expect(
      screen.getByRole('heading', { name: 'Install Local Service' }),
    ).toBeInTheDocument();
    expect(screen.getByText('npx my-block-explorer')).toBeInTheDocument();
    expect(screen.getByLabelText('API URL')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    // The app stays in the DOM under the overlay.
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('the overlay closes back to the banner and can be reopened', () => {
    renderGate({ status: 'not-found' });

    fireEvent.click(screen.getByRole('button', { name: 'Open setup' }));
    fireEvent.click(screen.getByRole('button', { name: /Back to explorer/ }));

    expect(
      screen.queryByRole('heading', { name: 'Block Explorer Setup' }),
    ).toBeNull();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open setup' }));
    expect(
      screen.getByRole('heading', { name: 'Block Explorer Setup' }),
    ).toBeInTheDocument();
  });

  it('connecting via manual URL flips to connected without remounting the app', () => {
    const children = <div data-testid="app-content" />;
    const { setApiUrl, rerender } = renderGate({ status: 'not-found' }, children);

    fireEvent.click(screen.getByRole('button', { name: 'Open setup' }));
    fireEvent.change(screen.getByLabelText('API URL'), {
      target: { value: 'http://localhost:8201' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(setApiUrl).toHaveBeenCalledWith('http://localhost:8201');

    const appNode = screen.getByTestId('app-content');
    rerender(
      <DiscoveryGate
        status="found"
        error={null}
        isScanning={false}
        setApiUrl={setApiUrl}
        discover={vi.fn()}
      >
        {children}
      </DiscoveryGate>,
    );

    // Connected: banner and overlay are gone, and the very same DOM node
    // survived the transition — no remount, no reload.
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Block Explorer Setup' }),
    ).toBeNull();
    expect(screen.getByTestId('app-content')).toBe(appNode);
  });

  it('shows the discovery error inside the setup overlay', () => {
    renderGate({ status: 'not-found', error: 'Request timeout' });

    fireEvent.click(screen.getByRole('button', { name: 'Open setup' }));

    expect(screen.getByText('Request timeout')).toBeInTheDocument();
  });
});
