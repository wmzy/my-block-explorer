import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { db } from '../database/init';
import { sql } from 'drizzle-orm';
import { createApiError } from '../utils/api-error';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';

const logger = createLogger('debug-routes');

const app = new Hono();

// Opt-in gate for every endpoint in this sub-app: a zero-config local
// session keeps the SQL tool working, but once ADMIN_TOKEN is configured
// the x-admin-token header is enforced. Publicly reachable bindings are
// handled earlier — the startup check refuses to boot this app on a
// non-loopback HOST unless ALLOW_INSECURE_START=1 (see src/startupChecks.ts).
app.use('*', requireAdminTokenIfConfigured);

/**
 * POST /debug/db/query
 * Execute arbitrary SQL query against DuckDB (development only)
 */
app.post('/db/query', async c => {
  try {
    const body = await c.req.json<{ sql: string }>();
    const { sql: query } = body;

    if (!query || typeof query !== 'string') {
      return c.json(createApiError(400, 'Bad Request', 'Missing or invalid sql parameter'), 400);
    }

    // Warn about dangerous operations
    const sqlUpper = query.toUpperCase();
    if (sqlUpper.includes('DROP') || sqlUpper.includes('DELETE') || sqlUpper.includes('TRUNCATE')) {
      logger.warn({ sql: query }, 'Dangerous SQL operation via debug endpoint');
    }

    const result = await db.execute(sql.raw(query));

    return c.json({
      success: true,
      rowCount: result.length,
      rows: result,
    });
  } catch (error) {
    logger.error({ err: error }, 'Debug DB query error');
    const causeChain: string[] = [];
    if (error instanceof Error) {
      causeChain.push(error.message);
    }
    return c.json(
      createApiError(
        500,
        'Query Failed',
        error instanceof Error ? causeChain.join('\n') : 'Unknown error',
      ),
      500,
    );
  }
});

export default app;
