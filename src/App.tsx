import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { cx } from '@linaria/core';
import { lightTheme, spacing, typography, ToastContainer } from 'haze-ui';
import HomePage from './pages/HomePage';
import AddressPage from './pages/AddressPage';
import BlockPage from './pages/BlockPage';
import TransactionPage from './pages/TransactionPage';
import ContractPage from './pages/ContractPage';
import BlocksListPage from './pages/BlocksListPage';
import TransactionsListPage from './pages/TransactionsListPage';
import { SearchPage } from './pages/SearchPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppQueryProvider } from './hooks/useQueryClient';
import { globalStyles, hazeThemeWrapper } from '@/styles/global';

export function App() {
  return (
    <ErrorBoundary>
      <AppQueryProvider>
        <BrowserRouter>
          <div className={cx(globalStyles, hazeThemeWrapper, lightTheme, spacing, typography)}>
            <ToastContainer>
              <Routes>
                <Route path="/chain/:chainId" element={<HomePage />} />
                <Route path="/chain/:chainId/blocks" element={<BlocksListPage />} />
                <Route
                  path="/chain/:chainId/transactions"
                  element={<TransactionsListPage />}
                />
                <Route
                  path="/chain/:chainId/block/:blockNumber"
                  element={<BlockPage />}
                />
                <Route
                  path="/chain/:chainId/tx/:txHash"
                  element={<TransactionPage />}
                />
                <Route
                  path="/chain/:chainId/address/:address"
                  element={<AddressPage />}
                />
                <Route
                  path="/chain/:chainId/contract/:address"
                  element={<ContractPage />}
                />
                <Route
                  path="/chain/:chainId/contract/:address/events"
                  element={<ContractPage />}
                />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/" element={<Navigate to="/chain/1" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </ToastContainer>
          </div>
        </BrowserRouter>
      </AppQueryProvider>
    </ErrorBoundary>
  );
}
