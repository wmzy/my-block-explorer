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

app.get('/chains/:chainId/transactions', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const limit = parseInt(c.req.query('limit') ?? '20');

  try {
    const transactions = await transactionService.getLatestTransactions(
      chainId,
      limit,
    );
    c.header('X-Data-Source', 'database');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      transactions: transactions.map(formatTransactionForApi),
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
