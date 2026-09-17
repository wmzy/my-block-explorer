// SetupRequiredScreen mixed-content honesty: on HTTPS-hosted deployments
// (e.g. the GitHub Pages demo) browsers may block the automatic localhost
// port scan, so the setup screen must explain why "no service detected"
// can be a false negative — but only on HTTPS pages, never on HTTP.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';
import { SetupRequiredScreen } from '@/components/ServiceSetup/SetupRequiredScreen';

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
});
