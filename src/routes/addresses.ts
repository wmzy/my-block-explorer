import { Hono } from "hono";
import { AddressService } from "@/server/services/AddressService";
import { RpcManager } from "@/server/services/RpcManager";
import {
  getValidatedChainId,
  getValidatedAddress,
  getValidatedBlockNumber,
} from "@/server/validation";
import { timingMiddleware } from "@/server/middleware/timing";

// 创建服务实例
const rpcManager = new RpcManager();
const addressService = new AddressService(rpcManager);

// 创建地址路由
export const addressesRouter = new Hono();

// 添加通用中间件
addressesRouter.use("*", timingMiddleware);

// 获取地址信息
// GET /api/chains/:chainId/addresses/:address
addressesRouter.get("/:chainId/addresses/:address", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));

    const addressInfo = await addressService.getAddressInfo(chainId, address);

    c.header("X-Data-Source", "hybrid");
    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Address", address);
    c.header("X-Is-Contract", addressInfo.isContract.toString());

    return c.json(addressInfo);
  } catch (error) {
    throw error;
  }
});

// 获取地址余额
// GET /api/chains/:chainId/addresses/:address/balance
addressesRouter.get("/:chainId/addresses/:address/balance", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));

    const balance = await addressService.getAddressBalance(chainId, address);

    c.header("X-Data-Source", "rpc");
    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Address", address);

    return c.json({ balance });
  } catch (error) {
    throw error;
  }
});

// 获取地址在指定区块的余额
// GET /api/chains/:chainId/addresses/:address/balance/:blockNumber
addressesRouter.get(
  "/:chainId/addresses/:address/balance/:blockNumber",
  async (c) => {
    try {
      const chainId = getValidatedChainId(c.req.param("chainId"));
      const address = getValidatedAddress(c.req.param("address"));
      const blockNumber = getValidatedBlockNumber(c.req.param("blockNumber"));

      const balance = await addressService.getAddressBalanceAtBlock(
        chainId,
        address,
        blockNumber
      );

      c.header("X-Data-Source", "rpc");
      c.header("X-Chain-Id", chainId.toString());
      c.header("X-Address", address);
      c.header("X-Block-Number", blockNumber.toString());

      return c.json({ balance, blockNumber });
    } catch (error) {
      throw error;
    }
  }
);

// 获取地址交易数量
// GET /api/chains/:chainId/addresses/:address/nonce
addressesRouter.get("/:chainId/addresses/:address/nonce", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));

    const transactionCount = await addressService.getAddressTransactionCount(
      chainId,
      address
    );

    c.header("X-Data-Source", "rpc");
    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Address", address);

    return c.json({
      transactionCount,
      nonce: transactionCount, // 对于EOA账户，nonce等于交易数量
    });
  } catch (error) {
    throw error;
  }
});

// 检查地址是否为合约
// GET /api/chains/:chainId/addresses/:address/contract
addressesRouter.get("/:chainId/addresses/:address/contract", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));

    const isContract = await addressService.isContract(chainId, address);

    c.header("X-Data-Source", "rpc");
    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Address", address);
    c.header("X-Is-Contract", isContract.toString());

    return c.json({ isContract });
  } catch (error) {
    throw error;
  }
});

// 设置地址标签
// POST /api/chains/:chainId/addresses/:address/label
addressesRouter.post("/:chainId/addresses/:address/label", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));
    const { label } = await c.reqon();

    if (!label || typeof label !== "string" || label.length > 100) {
      return c.json(
        {
          code: "INVALID_LABEL",
          message: "Label must be a string with maximum 100 characters",
        },
        400
      );
    }

    await addressService.setAddressLabel(chainId, address, label);

    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Address", address);

    return c.json({ success: true });
  } catch (error) {
    throw error;
  }
});

// 获取地址标签
// GET /api/chains/:chainId/addresses/:address/label
addressesRouter.get("/:chainId/addresses/:address/label", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));

    const label = await addressService.getAddressLabel(chainId, address);

    c.header("X-Data-Source", "db");
    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Address", address);

    return c.json({ label });
  } catch (error) {
    throw error;
  }
});

// 删除地址标签
// DELETE /api/chains/:chainId/addresses/:address/label
addressesRouter.delete("/:chainId/addresses/:address/label", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));

    await addressService.removeAddressLabel(chainId, address);

    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Address", address);

    return c.json({ success: true });
  } catch (error) {
    throw error;
  }
});

// 获取最近查询的地址
// GET /api/chains/:chainId/addresses/recent
addressesRouter.get("/:chainId/addresses/recent", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const limit = parseInt(c.req.query("limit") || "20", 10);

    if (limit < 1 || limit > 100) {
      return c.json(
        {
          code: "INVALID_LIMIT",
          message: "Limit must be between 1 and 100",
        },
        400
      );
    }

    const addresses = await addressService.getRecentlyQueriedAddresses(
      chainId,
      limit
    );

    c.header("X-Data-Source", "db");
    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Total-Count", addresses.length.toString());

    return c.json({ data: addresses });
  } catch (error) {
    throw error;
  }
});

// 批量获取地址余额
// POST /api/chains/:chainId/addresses/balances
addressesRouter.post("/:chainId/addresses/balances", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const { addresses } = await c.reqon();

    if (
      !Array.isArray(addresses) ||
      addresses.length === 0 ||
      addresses.length > 100
    ) {
      return c.json(
        {
          code: "INVALID_ADDRESSES",
          message: "Addresses must be an array with 1-100 items",
        },
        400
      );
    }

    // 验证所有地址
    for (const addr of addresses) {
      if (typeof addr !== "string" || !isValidAddress(addr)) {
        return c.json(
          {
            code: "INVALID_ADDRESS",
            message: `Invalid address: ${addr}`,
          },
          400
        );
      }
    }

    const balanceMap = await addressService.getBatchAddressBalances(
      chainId,
      addresses
    );

    c.header("X-Data-Source", "rpc");
    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Address-Count", addresses.length.toString());

    return c.json({ balances: Object.fromEntries(balanceMap) });
  } catch (error) {
    throw error;
  }
});

// 获取地址余额变化检测（用于交易查找）
// GET /api/chains/:chainId/addresses/:address/balance-changes
addressesRouter.get(
  "/:chainId/addresses/:address/balance-changes",
  async (c) => {
    try {
      const chainId = getValidatedChainId(c.req.param("chainId"));
      const address = getValidatedAddress(c.req.param("address"));
      const fromBlock = parseInt(c.req.query("fromBlock") || "0", 10);
      const toBlock = parseInt(c.req.query("toBlock") || "0", 10);
      const maxSamples = parseInt(c.req.query("maxSamples") || "20", 10);

      if (fromBlock < 0 || toBlock < fromBlock) {
        return c.json(
          {
            code: "INVALID_BLOCK_RANGE",
            message: "Invalid block range",
          },
          400
        );
      }

      if (maxSamples < 1 || maxSamples > 100) {
        return c.json(
          {
            code: "INVALID_MAX_SAMPLES",
            message: "maxSamples must be between 1 and 100",
          },
          400
        );
      }

      const balanceChanges = await addressService.detectBalanceChanges(
        chainId,
        address,
        fromBlock,
        toBlock,
        maxSamples
      );

      c.header("X-Data-Source", "rpc");
      c.header("X-Chain-Id", chainId.toString());
      c.header("X-Address", address);
      c.header("X-Sample-Count", balanceChanges.length.toString());

      return c.json({ data: balanceChanges });
    } catch (error) {
      throw error;
    }
  }
);
