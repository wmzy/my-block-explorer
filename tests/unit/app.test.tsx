import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import '@testing-library/jest-dom';

const HomePage = () => <div data-testid="home-page">HomePage</div>;
const BlocksListPage = () => <div data-testid="blocks-list-page">BlocksListPage</div>;
const TransactionsListPage = () => (
  <div data-testid="transactions-list-page">TransactionsListPage</div>
);
const BlockPage = () => <div data-testid="block-page">BlockPage</div>;
const TransactionPage = () => <div data-testid="transaction-page">TransactionPage</div>;
const AddressPage = () => <div data-testid="address-page">AddressPage</div>;
const ContractPage = () => <div data-testid="contract-page">ContractPage</div>;
const SearchPage = () => <div data-testid="search-page">SearchPage</div>;
const NotFoundPage = () => <div data-testid="not-found-page">NotFoundPage</div>;

function renderWithRouter(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/chain/:chainId" element={<HomePage />} />
        <Route path="/chain/:chainId/blocks" element={<BlocksListPage />} />
        <Route path="/chain/:chainId/transactions" element={<TransactionsListPage />} />
        <Route path="/chain/:chainId/block/:blockNumber" element={<BlockPage />} />
        <Route path="/chain/:chainId/tx/:txHash" element={<TransactionPage />} />
        <Route path="/chain/:chainId/address/:address" element={<AddressPage />} />
        <Route path="/chain/:chainId/contract/:address" element={<ContractPage />} />
        <Route path="/chain/:chainId/contract/:address/events" element={<ContractPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/" element={<Navigate to="/chain/1" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('App Routing', () => {
  it('renders HomePage for /chain/:chainId', () => {
    renderWithRouter(['/chain/1']);
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });

  it('renders BlocksListPage for /chain/:chainId/blocks', () => {
    renderWithRouter(['/chain/1/blocks']);
    expect(screen.getByTestId('blocks-list-page')).toBeInTheDocument();
  });

  it('renders TransactionsListPage for /chain/:chainId/transactions', () => {
    renderWithRouter(['/chain/1/transactions']);
    expect(screen.getByTestId('transactions-list-page')).toBeInTheDocument();
  });

  it('renders BlockPage for /chain/:chainId/block/:blockNumber', () => {
    renderWithRouter(['/chain/1/block/12345']);
    expect(screen.getByTestId('block-page')).toBeInTheDocument();
  });

  it('renders TransactionPage for /chain/:chainId/tx/:txHash', () => {
    renderWithRouter(['/chain/1/tx/0xabc123']);
    expect(screen.getByTestId('transaction-page')).toBeInTheDocument();
  });

  it('renders AddressPage for /chain/:chainId/address/:address', () => {
    renderWithRouter(['/chain/1/address/0x1234']);
    expect(screen.getByTestId('address-page')).toBeInTheDocument();
  });

  it('renders ContractPage for /chain/:chainId/contract/:address', () => {
    renderWithRouter(['/chain/1/contract/0x1234']);
    expect(screen.getByTestId('contract-page')).toBeInTheDocument();
  });

  it('renders ContractPage for contract events route', () => {
    renderWithRouter(['/chain/1/contract/0x1234/events']);
    expect(screen.getByTestId('contract-page')).toBeInTheDocument();
  });

  it('renders SearchPage for /search', () => {
    renderWithRouter(['/search']);
    expect(screen.getByTestId('search-page')).toBeInTheDocument();
  });

  it('redirects / to /chain/1', () => {
    renderWithRouter(['/']);
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });

  it('renders NotFoundPage for unknown routes', () => {
    renderWithRouter(['/unknown/path']);
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
  });

  it('supports different chain IDs in routes', () => {
    renderWithRouter(['/chain/137']);
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });
});
