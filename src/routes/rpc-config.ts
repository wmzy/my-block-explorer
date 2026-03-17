import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createLogger } from "../server/logger";
import { db, userRpcConfigs } from "../database/init";

const logger = createLogger("rpc-config-routes");
import { rpcManager } from "../services/RpcManager";
import { getValidatedChainId } from "../server/validation";

const app = new Hono();

app.get("/rpc-configs", async (c) => {
  try {
    const configs = await db.select().from(userRpcConfigs);

    return c.json({
      configs: configs.map((config) => ({
        id: config.chainId.toString(),
        chainId: config.chainId,
        name: config.name,
        url: config.url,
        isCustom: true,
        supportsHistory: config.supportsHistory,
        maxEventRange: config.maxEventRange,
      })),
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to get RPC configs");
    return c.json({ error: "Failed to get RPC configs" }, 500);
  }
});

app.post("/rpc-configs", async (c) => {
  try {
    const body = await c.req.json();
    const { chainId, name, url, supportsHistory, maxEventRange } = body;

    if (!chainId || !name || !url) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const existing = await db
      .select({ chainId: userRpcConfigs.chainId })
      .from(userRpcConfigs)
      .where(eq(userRpcConfigs.chainId, chainId));

    if (existing.length > 0) {
      await db
        .update(userRpcConfigs)
        .set({
          name,
          url,
          supportsHistory,
          maxEventRange,
          updatedAt: new Date(),
        })
        .where(eq(userRpcConfigs.chainId, chainId));
    } else {
      await db.insert(userRpcConfigs).values({
        chainId,
        name,
        url,
        supportsHistory,
        maxEventRange,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await rpcManager.reloadConfigs();

    return c.json({ success: true });
  } catch (error) {
    logger.error(
      { err: error, stack: error instanceof Error ? error.stack : undefined },
      "Failed to save RPC config"
    );
    return c.json({ error: "Failed to save RPC config" }, 500);
  }
});

app.delete("/rpc-configs/:chainId", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));

    await db.delete(userRpcConfigs).where(eq(userRpcConfigs.chainId, chainId));

    await rpcManager.reloadConfigs();

    return c.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Failed to delete RPC config");
    return c.json({ error: "Failed to delete RPC config" }, 500);
  }
});

export default app;
