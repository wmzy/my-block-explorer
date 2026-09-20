import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { transactionService } from '../services/TransactionService';
import { getChainName } from '../config/chains';

const logger = createLogger('transactions-routes');
import { getValidatedChainId } from '../server/validation';
import { formatTransactionForApi, safeJsonResponse } from '../utils/serialization';

const app = new Hono();

app.get('/chains/:chainId/transactions/:hash', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const hash = c.req.param('hash');

  try {
    const transaction = await transactionService.getTransactionByHash(
      chainId,
      hash,
    );

    if (!transaction) {
      return c.json({ error: 'Transaction not found' }, 404);
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
  }
  catch (error) {
    logger.error({ err: error }, 'Transaction API error');
    return c.json({ error: 'Failed to get transaction' }, 500);
  }
});

// Pagination sanity bounds: offset is clamped non-negative and capped so a
// runaway client cannot make DuckDB scan arbitrarily deep into the table.
const MAX_TRANSACTION_OFFSET = 100_000;

const parseOffsetParam = (raw: string | undefined): number | null => {
  if (raw === undefined || raw === '') return 0;
  const parsed = parseInt(raw, 10);
  // Malformed pagination params fail loudly with 400 instead of being
  // silently treated as 0 — a wrong page is worse than an error.
  if (Number.isNaN(parsed)) return null;
  return Math.min(Math.max(parsed, 0), MAX_TRANSACTION_OFFSET);
};

app.get('/chains/:chainId/transactions', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const limit = parseInt(c.req.query('limit') ?? '20');
  const offset = parseOffsetParam(c.req.query('offset'));

  if (offset === null) {
    return c.json(
      {
        error: 'Invalid offset',
        message: 'offset must be a non-negative integer',
      },
      400,
    );
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
  }
  catch (error) {
    logger.error({ err: error }, 'Transactions API error');
    return c.json({ error: 'Failed to get transactions' }, 500);
  }
});

export default app;
