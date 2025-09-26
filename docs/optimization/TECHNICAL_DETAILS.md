# 技术实现细节

## 🏗️ 架构变更

### AddressService 重构
```typescript
export class AddressService {
  // 核心方法：获取持久化数据
  async getPersistentAddressData(chainId: number, address: Address) {
    // 1. 检查数据库缓存
    const cached = await this.getPersistentDataFromDB(chainId, address);
    if (cached) return cached;

    // 2. 获取并存储持久化数据
    const client = await rpcManager.getClient(chainId);
    const code = await client.getCode({ address });
    const isContract = Boolean(code && code !== "0x" && code.length > 2);

    let persistentData = { isContract };

    if (isContract) {
      // 获取合约信息
      const [creationInfo, sourceInfo] = await Promise.all([
        contractSourceService.getContractCreationInfo(chainId, address),
        contractSourceService.getContractSource(chainId, address)
      ]);
      
      if (creationInfo) {
        persistentData.contractCreationTx = creationInfo.txHash;
        persistentData.contractCreationBlock = creationInfo.blockNumber;
        persistentData.contractCreator = creationInfo.creator;
      }

      if (sourceInfo) {
        persistentData.contractName = sourceInfo.name;
        persistentData.verificationStatus = sourceInfo.verificationStatus;
        persistentData.sourceCodeAvailable = sourceInfo.sourceCode.length > 0;
        persistentData.isProxy = sourceInfo.isProxy;
        persistentData.proxyType = sourceInfo.proxyType;
        persistentData.implementationAddress = sourceInfo.implementationAddress;
      }
    }

    // 3. 保存到数据库
    await this.savePersistentDataToDB(chainId, address, persistentData);
    return persistentData;
  }
}
```

### 前端工具函数
```typescript
// src/utils/realTimeData.ts
export const getRealTimeAddressData = async (chainId: number, address: string) => {
  const client = createRpcClient(chainId);
  
  const [balance, txCount, latestBlock] = await Promise.all([
    client.getBalance({ address: address as `0x${string}` }),
    client.getTransactionCount({ address: address as `0x${string}` }),
    client.getBlockNumber(),
  ]);

  return {
    balance: formatEther(balance),
    balanceWei: balance.toString(),
    transactionCount: txCount,
    latestBlock: Number(latestBlock),
  };
};
```

## 📊 数据库优化

### 高效查询
```sql
SELECT "type", "first_seen", "indexed_at" 
FROM "indexed_addresses" 
WHERE ("chain_id" = $1 AND "address" = $2) 
LIMIT 1;
```

### 缓存策略
- **持久化数据**: 永久缓存（合约信息不会改变）
- **实时数据**: 前端直接获取（保证数据新鲜度）

## 🔧 关键文件

- `src/services/AddressService.ts` - 持久化数据服务
- `src/utils/realTimeData.ts` - 前端RPC工具
- `src/api-app.ts` - API端点实现
- `src/routes/addresses.ts` - 简化的路由模块
