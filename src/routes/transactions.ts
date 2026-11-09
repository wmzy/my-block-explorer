import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { transactionService } from '../services/TransactionService';
import { getChainName } from '../config/chains';

const logger = createLogger('transactions-routes');
import { getValidatedChainId } from '../server/validation';
import { parsePaginationParams } from '../utils/validation';
import { formatTransactionForApi, safeJsonResponse } from '../utils/serialization';
import { invalidLimitResponse, invalidOffsetResponse, respondError } from '../utils/api-error';

const app = new Hono();

app.get('/chains/:chainId/transactions/:hash', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const hash = c.req.param('hash');

  try {
    const transaction = await transactionService.getTransactionByHash(chainId, hash);

    if (!transaction) {
      return respondError(c, 404, 'transaction_not_found', 'Transaction not found');
    }

    c.header('X-Data-Source', 'blockchain');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      transaction: formatTransactionForApi(transaction),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Transaction API error');
    return respondError(c, 500, 'internal_error', 'Failed to get transaction');
  }
});

// Pagination sanity bounds: offset is clamped non-negative and capped so a
// runaway client cannot make DuckDB scan arbitrarily deep into the table.
const MAX_TRANSACTION_OFFSET = 100_000;
// Same family of bounds for the page size; 100 keeps one page well under
// the row cost of a deep offset scan. The parsing itself (strict decimal
// or 400, negative offset clamps, over-cap clamps) is the shared
// parsePaginationParams contract.
const MAX_TRANSACTION_LIMIT = 100;

app.get('/chains/:chainId/transactions', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const { offset, limit } = parsePaginationParams(c.req.query('offset'), c.req.query('limit'), {
    maxOffset: MAX_TRANSACTION_OFFSET,
    maxLimit: MAX_TRANSACTION_LIMIT,
  });

  if (limit === null) {
    return invalidLimitResponse(c);
  }

  if (offset === null) {
    return invalidOffsetResponse(c);
  }

  try {
    const { transactions, total } = await transactionService.getLatestTransactions(
      chainId,
      limit,
      offset,
    );
    c.header('X-Data-Source', 'database');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      transactions: transactions.map(formatTransactionForApi),
      total,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Transactions API error');
    return respondError(c, 500, 'internal_error', 'Failed to get transactions');
  }
});

export default app;
