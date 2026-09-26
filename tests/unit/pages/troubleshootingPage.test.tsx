// Troubleshooting page (/help/troubleshooting) contract: static, honest
// copy for the failure modes users actually hit — the backend-discovery
// banner with all three run-mode names and the npx command (pinned to
// docs/INSTALLATION.md's wording), the known RPC provider quirks with
// their literal symptom strings, the dev-chain reset story, the coverage
// vocabulary link, and every /api/health field. Pure content page: no
// service mocks — only a router context so the TypedLink to the coverage
// legend resolves.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import Troubleshooting from '@/views/Help/Troubleshooting';

const LegendStub = () => <span data-testid="legend-stub" />;

const routes = createRoutes([
  { path: '/help/troubleshooting', component: () => Troubleshooting },
  { path: '/about/coverage', component: () => LegendStub },
]);

const renderPage = async () => {
  render(
    <MemoryRouter routes={routes} initialEntries={['/help/troubleshooting']}>
      <View />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Troubleshooting' })).toBeInTheDocument();
};

describe('Troubleshooting page sections', () => {
  it('renders the page header and all six section headings', async () => {
    await renderPage();

    for (const heading of [
      /Backend not found/,
      'RPC provider quirks',
      'Local dev chains (anvil, Hardhat)',
      'Reading the coverage badges',
      'Health checklist',
      'Still broken? Report it',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
  });

  it('explains the backend banner with the three run modes and the npx command', async () => {
    await renderPage();

    // The three run-mode names must not drift from docs/INSTALLATION.md.
    expect(screen.getByText(/RPC-only/)).toBeInTheDocument();
    expect(screen.getByText(/Local backend/)).toBeInTheDocument();
    expect(screen.getByText(/Shared deployment/)).toBeInTheDocument();
    // The command every setup surface agrees on, copyable verbatim.
    expect(screen.getByText('npx my-block-explorer --port 8201')).toBeInTheDocument();
    // What the banner means: discovery scope + what keeps working.
    expect(screen.getByText('localhost:8201–8205')).toBeInTheDocument();
    expect(screen.getByText(/straight from the chain/)).toBeInTheDocument();
  });

  it('covers every known RPC provider quirk with its literal symptom string', async () => {
    await renderPage();

    for (const symptom of [
      /block range too large/,
      /results exceed limit/,
      /historical state/,
      /missing trie node/,
      'Pending page shows an unsupported card',
      'Call Trace / Internal Txns render as unavailable',
      'HTTP 429 responses',
    ]) {
      expect(screen.getByText(symptom)).toBeInTheDocument();
    }
    // The honest-degrade vocabulary and the fixes, not just the symptoms.
    expect(screen.getByText(/partial coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/archive-mode RPC/i)).toBeInTheDocument();
    expect(screen.getByText(/txpool/)).toBeInTheDocument();
    expect(screen.getByText(/debug_traceTransaction/)).toBeInTheDocument();
    expect(screen.getByText(/Retry-After/i)).toBeInTheDocument();
  });

  it('tells the dev-chain reset story: banner flow plus custom chain registration', async () => {
    await renderPage();

    expect(screen.getByText(/chain-reset banner/i)).toBeInTheDocument();
    expect(screen.getByText(/Add custom chain/i)).toBeInTheDocument();
    // The trap itself: reset wipes history while the chain id stays.
    expect(screen.getByText(/same chain id/i)).toBeInTheDocument();
    expect(screen.getByText(/cached-immutable/i)).toBeInTheDocument();
  });

  it('links the coverage vocabulary at /about/coverage', async () => {
    await renderPage();

    const link = screen.getByRole('link', { name: 'data coverage page' });
    expect(link).toHaveAttribute('href', '/about/coverage');
    // Every coverage word the badges use appears in the pointer copy.
    expect(
      screen.getByText(/live, cached, discovered, sampled, partial or unavailable/i),
    ).toBeInTheDocument();
  });

  it('documents every /api/health field the backend actually returns', async () => {
    await renderPage();

    // Field names as returned by src/api-app.ts's /api/health handler.
    for (const field of [
      'status',
      'adminTokenConfigured',
      'debugApiEnabled',
      'version',
      'timestamp',
    ]) {
      expect(screen.getByText(field)).toBeInTheDocument();
    }
    // And the curl that produces them.
    expect(screen.getByText(/curl http:\/\/localhost:8201\/api\/health/)).toBeInTheDocument();
  });

  it('points bug reports at the Ops diagnostics copy and the issue templates', async () => {
    await renderPage();

    expect(screen.getByText(/Copy diagnostics/i)).toBeInTheDocument();
    expect(screen.getByText('/api/health')).toBeInTheDocument();
    expect(screen.getByText(/ISSUE_TEMPLATE/)).toBeInTheDocument();
  });
});
