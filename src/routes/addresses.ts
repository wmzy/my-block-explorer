import { Hono } from "hono";
import { AddressService } from "@/services/AddressService";
import { getValidatedChainId, getValidatedAddress } from "../server/validation";
import { getChainName } from "@/config/chains";
import { safeJsonResponse } from "@/utils/serialization";

// 创建服务实例
const addressService = new AddressService();

// 创建地址路由
export const addressesRouter = new Hono();

// 获取地址持久化信息
// GET /api/chains/:chainId/addresses/:address/persistent
addressesRouter.get("/:chainId/addresses/:address/persistent", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));

    const persistentData = await addressService.getPersistentAddressData(
      chainId,
      address
    );

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
    console.error("Address persistent data API error:", error);
    return c.json({ error: "Failed to get address persistent data" }, 500);
  }
});

// 获取地址信息（兼容性端点）
// GET /api/chains/:chainId/addresses/:address
addressesRouter.get("/:chainId/addresses/:address", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));

    const addressInfo = await addressService.getAddressInfo(chainId, address);

    c.header("X-Data-Source", "hybrid");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address: addressInfo,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Address API error:", error);
    return c.json({ error: "Failed to get address info" }, 500);
  }
});
