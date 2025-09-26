# 前端新架构使用指南

## 🚀 useAddressData Hook

新的 `useAddressData` hook 实现了数据分离架构，自动处理持久化数据和实时数据的获取。

### 基本用法

```typescript
import { useAddressData } from "@/hooks/useAddressData";

function AddressPage() {
  const addressData = useAddressData(chainId, address);
  
  // 访问持久化数据（合约信息等）
  const isContract = addressData.persistent?.isContract;
  const contractName = addressData.persistent?.contractName;
  
  // 访问实时数据（余额等）
  const balance = addressData.realTime?.balance;
  const txCount = addressData.realTime?.transactionCount;
  
  // 处理加载状态
  const isLoadingPersistent = addressData.loading.persistent;
  const isLoadingRealTime = addressData.loading.realTime;
  
  // 处理错误
  const persistentError = addressData.error.persistent;
  const realTimeError = addressData.error.realTime;
}
```

### 数据类型

#### PersistentAddressData (持久化数据)
```typescript
type PersistentAddressData = {
  isContract: boolean;
  contractCreationTx?: string;
  contractCreationBlock?: number;
  contractCreator?: string;
  contractName?: string;
  verificationStatus?: "verified" | "unverified" | "partial";
  sourceCodeAvailable?: boolean;
  compilerVersion?: string;
  isProxy?: boolean;
  proxyType?: string;
  implementationAddress?: string;
  firstSeenBlock?: number;
  firstSeenTimestamp?: Date;
};
```

#### RealTimeAddressData (实时数据)
```typescript
type RealTimeAddressData = {
  balance: string;        // 格式化后的余额 (如 "1.234567")
  balanceWei: string;     // 原始 wei 值
  transactionCount: number;
  latestBlock: number;
};
```

## 📊 性能优势

### 并行加载
- 持久化数据和实时数据**并行获取**
- 不会互相阻塞，提升用户体验

### 智能缓存
- 持久化数据：数据库缓存，响应时间 1-9ms
- 实时数据：直接RPC，保证数据新鲜度

### 错误隔离
- 持久化数据错误不影响实时数据显示
- 实时数据错误不影响合约信息显示

## 🎯 最佳实践

### 1. 条件渲染
```typescript
// ✅ 推荐：根据数据可用性条件渲染
{addressData.persistent?.isContract && (
  <div>Contract Name: {addressData.persistent.contractName}</div>
)}

{addressData.realTime && (
  <div>Balance: {addressData.realTime.balance} ETH</div>
)}
```

### 2. 加载状态处理
```typescript
// ✅ 推荐：分别处理不同数据的加载状态
<div>
  Balance: {
    addressData.realTime ? (
      `${addressData.realTime.balance} ETH`
    ) : addressData.loading.realTime ? (
      "Loading..."
    ) : addressData.error.realTime ? (
      "Error loading balance"
    ) : (
      "N/A"
    )
  }
</div>
```

### 3. 错误处理
```typescript
// ✅ 推荐：优雅的错误处理
const hasAnyError = addressData.error.persistent || addressData.error.realTime;
const errorMessage = addressData.error.persistent || addressData.error.realTime;

{hasAnyError && (
  <div className="error">
    {addressData.error.persistent && "Failed to load contract info. "}
    {addressData.error.realTime && "Failed to load balance info."}
  </div>
)}
```

## 🔄 迁移指南

### 从旧 API 迁移

**旧代码：**
```typescript
const [addressInfo, setAddressInfo] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  fetch(`/api/chains/${chainId}/addresses/${address}`)
    .then(response => response.json())
    .then(data => setAddressInfo(data.address));
}, [chainId, address]);
```

**新代码：**
```typescript
const addressData = useAddressData(chainId, address);
// 数据自动分离，性能更好，错误处理更优雅
```

### 数据访问对比

| 旧方式 | 新方式 |
|-------|-------|
| `addressInfo.balance` | `addressData.realTime?.balance` |
| `addressInfo.isContract` | `addressData.persistent?.isContract` |
| `addressInfo.contractName` | `addressData.persistent?.contractName` |
| `addressInfo.transactionCount` | `addressData.realTime?.transactionCount` |

## ⚡ 性能监控

在开发工具的网络面板中，你会看到：

1. **持久化数据请求**: `/api/chains/:chainId/addresses/:address/persistent`
   - 响应时间：1-9ms
   - 缓存命中率：接近100%

2. **实时数据获取**: 直接RPC调用
   - 响应时间：取决于RPC节点
   - 数据始终最新

这种分离确保了最佳的性能和用户体验！
