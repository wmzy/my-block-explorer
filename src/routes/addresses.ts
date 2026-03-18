import { Hono } from "hono";
import { createLogger } from "../server/logger";
import { addressService } from "../services/AddressService";
import { getChainName } from "../config/chains";

const logger = createLogger("addresses-routes");
import {
  getValidatedChainId,
  getValidatedAddress,
} from "../server/validation";
import { formatTransactionForApi, safeJsonResponse } from "../utils/serialization";

const app = new Hono();

app.get("/chains/:chainId/addresses/:address", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  try {
    const addressInfo = await addressService.getAddressInfo(chainId, address);
    c.header("X-Data-Source", "blockchain");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address: addressInfo,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, "Address API error");
    return c.json({ error: "Failed to get address info" }, 500);
  }
});

app.get("/chains/:chainId/addresses/:address/persistent", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  try {
    const persistentData =
      await addressService.getPersistentAddressData(chainId, address);

    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      ...persistentData,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, "Address persistent data API error");
    return c.json({ error: "Failed to get address persistent data" }, 500);
  }
});

app.get("/chains/:chainId/addresses/:address/transactions", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 50);
  const page = Math.max(parseInt(c.req.query("page") ?? "1"), 1);
  const offset = (page - 1) * limit;

  try {
    const result = await addressService.getAddressTransactions(
      chainId,
      address,
      limit,
      offset
    );
    c.header("X-Data-Source", result.method);
    c.header("X-Chain-Name", getChainName(chainId));

    const totalPages = Math.max(1, Math.ceil(result.total / limit));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      transactions: result.transactions.map(formatTransactionForApi),
      total: result.total,
      pagination: {
        page,
        limit,
        totalPages,
        total: result.total,
      },
      method: result.method,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, "Address transactions API error");
    return c.json({ error: "Failed to get address transactions" }, 500);
  }
});

export default app;
