# API 接口文档

## 概述

本文档描述了以太坊区块链浏览器后端 API 的详细接口规范，包括请求格式、响应格式、错误处理等。

## 基础信息

- **Base URL**: `http://localhost:3001/api`
- **协议**: HTTP/HTTPS
- **数据格式**: JSON
- **字符编码**: UTF-8
- **认证方式**: 无需认证（公开API）

## 通用规范

### 请求格式

#### HTTP方法
- `GET`: 查询数据
- `POST`: 创建数据（暂不支持）
- `PUT`: 更新数据（暂不支持）
- `DELETE`: 删除数据（暂不支持）

#### 请求头
```http
Content-Type: application/json
Accept: application/json
User-Agent: BlockExplorer/1.0
```

#### 查询参数
```typescript
type PaginationParams = {
  page?: number;    // 页码，从1开始，默认1
  limit?: number;   // 每页数量，默认20，最大100
  sort?: string;    // 排序字段
  order?: 'asc' | 'desc'; // 排序方向，默认desc
};

type FilterParams = {
  from?: string;    // 起始时间 (ISO 8601格式)
  to?: string;      // 结束时间 (ISO 8601格式)
  address?: string; // 地址过滤
  status?: number;  // 状态过滤
};
```

### 响应格式

#### 成功响应
```typescript
// 数据响应（通过HTTP状态码指示成功）
type DataResponse<T> = T;

// 列表响应包含分页信息
type ListResponse<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
};
```

#### 错误响应
```typescript
type ErrorResponse = {
  code: string;
  message: string;
  details?: any;
};
```

#### 响应头
```typescript
// 元数据通过响应头传递
type ResponseHeaders = {
  'X-Response-Time': string;        // 响应时间 "123ms"
  'X-Data-Source': string;          // 数据源 "cache" | "database" | "rpc"
  'X-API-Version': string;          // API版本 "1.0.0"
  'X-Request-ID': string;           // 请求ID
  'X-Timestamp': string;            // 响应时间戳
  'X-Cache-Status': string;         // 缓存状态 "hit" | "miss"
  'X-RateLimit-Remaining': string;  // 剩余请求次数
  'X-RateLimit-Reset': string;      // 限制重置时间
};
```

### 状态码

| 状态码 | 含义 | 说明 |
|--------|------|------|
| 200 | OK | 请求成功 |
| 400 | Bad Request | 请求参数错误 |
| 404 | Not Found | 资源不存在 |
| 429 | Too Many Requests | 请求频率过高 |
| 500 | Internal Server Error | 服务器内部错误 |
| 503 | Service Unavailable | 服务暂时不可用 |

## 数据类型

### 基础类型

```typescript
// 使用viem内置类型
import type { 
  Block as ViemBlock,
  Transaction as ViemTransaction,
  TransactionReceipt,
  Log,
  Address,
  Hash,
  Hex
} from 'viem';

// 扩展viem的Block类型，添加额外的统计信息
type Block = ViemBlock & {
  transactionCount: number;    // 交易数量
  size: number;                // 区块大小(字节)
  uncleCount?: number;         // 叔块数量（PoW链）
  reward?: string;             // 区块奖励
};

// 扩展viem的Transaction类型，添加额外的元数据
type Transaction = ViemTransaction & {
  status?: number;             // 交易状态 (1=成功, 0=失败)
  gasUsed?: string;            // 实际使用Gas
  timestamp: string;           // 时间戳
  effectiveGasPrice?: string;  // 实际Gas价格
};

// 地址信息（本地扩展类型）
type AddressInfo = {
  address: Address;            // 地址（使用viem的Address类型）
  balance: string;             // 余额 (bigint string)
  transactionCount: number;    // 交易次数
  firstSeenBlock: number;      // 首次出现区块
  lastSeenBlock: number;       // 最后出现区块
  isContract: boolean;         // 是否为合约
  contractCreator?: Address;   // 合约创建者
  creationTransaction?: Hash;  // 创建交易哈希
  totalReceived: string;       // 总接收金额
  totalSent: string;           // 总发送金额
  updatedAt: string;           // 更新时间
};

// 代币转账（基于viem的Log类型扩展）
type TokenTransfer = Log & {
  id: string;                  // 转账ID
  tokenAddress: Address;       // 代币合约地址
  from: Address;               // 发送方
  to: Address;                 // 接收方
  value: string;               // 转账数量 (bigint string)
  timestamp: string;           // 时间戳
  tokenInfo?: {
    name: string;
    symbol: string;
    decimals: number;
  };
};

// 搜索结果
type SearchResult = {
  type: 'block' | 'transaction' | 'address';
  data: Block | Transaction | AddressInfo;
  match: {
    field: string;             // 匹配字段
    value: string;             // 匹配值
    similarity?: number;       // 相似度 (0-1)
  };
};

// 网络统计
type NetworkStats = {
  latestBlock: number;         // 最新区块号
  avgBlockTime: number;        // 平均出块时间(秒)
  avgGasPrice: string;         // 平均Gas价格
  totalTransactions: number;   // 总交易数
  activeAddresses24h: number;  // 24小时活跃地址数
  totalSupply: string;         // 总供应量
  marketCap?: string;          // 市值
  price?: {
    usd: number;
    change24h: number;
  };
};

// 日统计
type DailyStats = {
  date: string;                // 日期 (YYYY-MM-DD)
  transactionCount: number;    // 交易数量
  blockCount: number;          // 区块数量
  avgGasPrice: string;         // 平均Gas价格
  totalGasUsed: string;        // 总Gas使用量
  activeAddresses: number;     // 活跃地址数
  totalValue: string;          // 总转账金额
  avgBlockTime: number;        // 平均出块时间
};
```

## 多链API路由设计

### 路由结构
所有API都通过链ID进行路由，格式为：`/api/chains/{chainId}/{resource}`

```
/api/chains/1/blocks/latest          # 以太坊最新区块
/api/chains/137/blocks/latest        # Polygon最新区块
/api/chains/56/transactions/0x123... # BSC交易详情
```

### 支持的链ID
支持所有viem内置的EVM兼容链，主要包括：

| 链ID | 网络 | 路径前缀 | viem定义 |
|------|------|----------|----------|
| 1 | Ethereum | `/api/chains/1/` | `mainnet` |
| 137 | Polygon | `/api/chains/137/` | `polygon` |
| 56 | BSC | `/api/chains/56/` | `bsc` |
| 42161 | Arbitrum | `/api/chains/42161/` | `arbitrum` |
| 8453 | Base | `/api/chains/8453/` | `base` |
| 10 | Optimism | `/api/chains/10/` | `optimism` |

> **说明**：链信息（名称、RPC、浏览器等）直接从viem的链定义获取，无需单独配置。用户只需要在访问特定链时，系统会自动支持。用户可选择配置私有RPC以获得更好的性能。

### 通用响应头
所有多链API都会包含以下响应头：
- `X-Chain-ID`: 当前链ID
- `X-Network`: 网络名称
- `X-Data-Source`: 数据来源（cache/database/rpc）
- `X-Response-Time`: 响应时间

## API 接口

### 链信息获取

前后端都直接使用viem的链定义，无需额外配置：

```typescript
import type { Chain } from 'viem';
import { mainnet, polygon, bsc, arbitrum, base, optimism } from 'viem/chains';

// 支持的链列表
export const SUPPORTED_CHAINS = [
  mainnet, polygon, bsc, arbitrum, base, optimism
];

// 根据chainId获取链信息
export function getChainInfo(chainId: number): Chain | null {
  return SUPPORTED_CHAINS.find(chain => chain.id === chainId) || null;
}

// 用户RPC配置类型（可选）
type UserRpcConfig = {
  chainId: number;
  customRpcUrl?: string;      // 用户自定义RPC
  rpcBackups?: string[];      // 备用RPC端点
  timeout?: number;           // 超时设置
  retryCount?: number;        // 重试次数
  rateLimit?: number;         // 请求限制
};

// 获取有效的RPC URL（自定义优先，否则viem默认）
export function getEffectiveRpcUrl(chainId: number, userConfig?: UserRpcConfig): string {
  if (userConfig?.customRpcUrl) {
    return userConfig.customRpcUrl;
  }
  
  const chain = getChainInfo(chainId);
  return chain?.rpcUrls.default.http[0] || '';
}
```

### 0. 链统计接口

#### 获取链的网络统计
```http
GET /api/chains/{chainId}/stats
```

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Chain-ID: 1
X-Network: Ethereum
X-Response-Time: 25ms

{
  "latestBlock": 18500000,
  "avgBlockTime": 12.1,
  "avgGasPrice": "25000000000",
  "tps": 15.2,
  "totalTransactions": 1500000000
}
```

### 1. 区块相关接口

#### 获取最新区块
```http
GET /api/chains/{chainId}/blocks/latest
```

**参数:**
- `chainId` (required): 链ID (1=Ethereum, 137=Polygon, 56=BSC, 等)

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 45ms
X-Data-Source: cache
X-Chain-ID: 1
X-Network: Ethereum
X-Cache-Status: hit

{
  "chainId": 1,
  "number": 18500000,
  "hash": "0x1234567890abcdef...",
  "parentHash": "0xabcdef1234567890...",
  "timestamp": "2023-11-15T10:30:00.000Z",
  "miner": "0x1234567890123456789012345678901234567890",
  "gasLimit": "30000000",
  "gasUsed": "15000000",
  "baseFeePerGas": "20000000000",
  "transactionCount": 150,
  "size": 50000,
  "network": "Ethereum"
}
```

#### 获取指定区块
```http
GET /api/chains/{chainId}/blocks/{number}
```

**参数:**
- `chainId` (required): 链ID
- `number` (required): 区块号或 'latest'

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 123ms
X-Data-Source: database
X-Cache-Status: miss

{
  "number": 18500000,
  "hash": "0x1234567890abcdef...",
  "transactions": [
    "0xabc123...",
    "0xdef456..."
  ]
}
```

#### 获取区块列表
```http
GET /api/chains/{chainId}/blocks
```

**查询参数:**
- `page` (optional): 页码，默认1
- `limit` (optional): 每页数量，默认20，最大100
- `sort` (optional): 排序字段，默认'number'
- `order` (optional): 排序方向，默认'desc'

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 67ms
X-Data-Source: database
X-Total-Count: 18500000

{
  "data": [
    {
      "number": 18500000,
      "hash": "0x1234567890abcdef...",
      "timestamp": "2023-11-15T10:30:00.000Z",
      "transactionCount": 150
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 18500000,
    "totalPages": 925000,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### 2. 交易相关接口

#### 获取交易详情
```http
GET /api/chains/{chainId}/transactions/{hash}
```

**参数:**
- `hash` (required): 交易哈希

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 35ms
X-Data-Source: database
X-Cache-Status: hit
X-API-Version: 1.0.0
X-Request-ID: req_tx_abc123

{
  "hash": "0xabc123...",
  "blockNumber": 18500000,
  "from": "0x1234567890123456789012345678901234567890",
  "to": "0x0987654321098765432109876543210987654321",
  "value": "1000000000000000000",
  "gasPrice": "20000000000",
  "gasUsed": "21000",
  "status": 1,
  "timestamp": "2023-11-15T10:30:00.000Z"
}
```

#### 获取交易列表
```http
GET /api/chains/{chainId}/transactions
```

**查询参数:**
- `page` (optional): 页码
- `limit` (optional): 每页数量
- `address` (optional): 地址过滤（发送方或接收方）
- `block` (optional): 区块号过滤
- `status` (optional): 状态过滤（0=失败，1=成功）
- `from` (optional): 起始时间
- `to` (optional): 结束时间

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 55ms
X-Data-Source: database
X-Cache-Status: partial
X-Total-Count: 1000000
X-Page: 1
X-Limit: 20

{
  "data": [
    {
      "hash": "0xabc123...",
      "blockNumber": 18500000,
      "from": "0x1234...",
      "to": "0x5678...",
      "value": "1000000000000000000",
      "timestamp": "2023-11-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1000000,
    "totalPages": 50000,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### 3. 地址相关接口

#### 获取地址信息
```http
GET /api/chains/{chainId}/addresses/{address}
```

**参数:**
- `address` (required): 以太坊地址

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 42ms
X-Data-Source: mixed
X-Cache-Status: partial
X-Last-Updated: 2023-11-15T10:30:00.000Z

{
  "address": "0x1234567890123456789012345678901234567890",
  "balance": "5000000000000000000",
  "transactionCount": 1250,
  "firstSeenBlock": 12000000,
  "lastSeenBlock": 18500000,
  "isContract": false,
  "totalReceived": "50000000000000000000",
  "totalSent": "45000000000000000000",
  "updatedAt": "2023-11-15T10:30:00.000Z"
}
```

#### 获取地址交易历史
```http
GET /api/chains/{chainId}/addresses/{address}/transactions
```

**参数:**
- `address` (required): 以太坊地址

**查询参数:**
- `page` (optional): 页码
- `limit` (optional): 每页数量
- `type` (optional): 交易类型（'in'=接收，'out'=发送，'all'=全部）
- `from` (optional): 起始时间
- `to` (optional): 结束时间

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 68ms
X-Data-Source: database
X-Cache-Status: miss
X-Total-Count: 1250
X-Indexed-Count: 850

{
  "data": [
    {
      "hash": "0xabc123...",
      "blockNumber": 18500000,
      "from": "0x1234...",
      "to": "0x5678...",
      "value": "1000000000000000000",
      "direction": "in",
      "timestamp": "2023-11-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1250,
    "totalPages": 63,
    "hasNext": true,
    "hasPrev": false
  }
}
```

#### 获取地址代币转账
```http
GET /api/chains/{chainId}/addresses/{address}/token-transfers
```

**参数:**
- `address` (required): 以太坊地址

**查询参数:**
- `page` (optional): 页码
- `limit` (optional): 每页数量
- `token` (optional): 代币合约地址过滤

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 85ms
X-Data-Source: database
X-Token-Count: 15
X-Total-Count: 450

{
  "data": [
    {
      "id": "12345",
      "transactionHash": "0xabc123...",
      "tokenAddress": "0xA0b86a33E6...",
      "from": "0x1234...",
      "to": "0x5678...",
      "value": "1000000000000000000",
      "timestamp": "2023-11-15T10:30:00.000Z",
      "tokenInfo": {
        "name": "USD Coin",
        "symbol": "USDC",
        "decimals": 6
      }
    }
  ]
}
```

### 4. 搜索接口

#### 通用搜索
```http
GET /api/search/:query
```

**参数:**
- `query` (required): 搜索关键词（地址、交易哈希、区块号等）

**查询参数:**
- `type` (optional): 搜索类型过滤（'block'、'transaction'、'address'）
- `limit` (optional): 返回结果数量，默认10

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 125ms
X-Data-Source: mixed
X-Search-Time: 98ms
X-Results-Count: 2

{
  "data": [
    {
      "type": "address",
      "data": {
        "address": "0x1234567890123456789012345678901234567890",
        "balance": "5000000000000000000",
        "transactionCount": 1250
      },
      "match": {
        "field": "address",
        "value": "0x1234567890123456789012345678901234567890",
        "similarity": 1.0
      }
    },
    {
      "type": "transaction",
      "data": {
        "hash": "0x1234567890abcdef...",
        "blockNumber": 18500000,
        "value": "1000000000000000000"
      },
      "match": {
        "field": "hash",
        "value": "0x1234567890abcdef...",
        "similarity": 0.95
      }
    }
  ]
}
```

### 5. 统计接口

#### 获取网络统计
```http
GET /api/stats/network
```

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 15ms
X-Data-Source: cache
X-Cache-TTL: 300
X-Last-Updated: 2023-11-15T10:29:45.000Z

{
  "latestBlock": 18500000,
  "avgBlockTime": 12.5,
  "avgGasPrice": "25000000000",
  "totalTransactions": 1500000000,
  "activeAddresses24h": 350000,
  "totalSupply": "120000000000000000000000000",
  "price": {
    "usd": 2100.50,
    "change24h": 2.5
  }
}
```

#### 获取日统计数据
```http
GET /api/stats/daily
```

**查询参数:**
- `days` (optional): 天数，默认30，最大365
- `metrics` (optional): 指标过滤，逗号分隔（'transactions'、'gas'、'addresses'等）

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 180ms
X-Data-Source: database
X-Days-Requested: 30
X-Calculation-Time: 155ms

{
  "data": [
    {
      "date": "2023-11-15",
      "transactionCount": 1200000,
      "blockCount": 7200,
      "avgGasPrice": "25000000000",
      "totalGasUsed": "180000000000",
      "activeAddresses": 350000,
      "totalValue": "500000000000000000000000",
      "avgBlockTime": 12.0
    },
    {
      "date": "2023-11-14",
      "transactionCount": 1150000,
      "blockCount": 7150,
      "avgGasPrice": "28000000000",
      "totalGasUsed": "175000000000",
      "activeAddresses": 340000,
      "totalValue": "480000000000000000000000",
      "avgBlockTime": 12.1
    }
  ]
}
```

#### 获取Gas价格统计
```http
GET /api/stats/gas
```

**查询参数:**
- `period` (optional): 时间周期（'1h'、'24h'、'7d'、'30d'），默认'24h'
- `granularity` (optional): 数据粒度（'5m'、'1h'、'1d'），默认根据period自动选择

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 35ms
X-Data-Source: rpc
X-Price-Source: network
X-Update-Frequency: 15s

{
  "current": {
    "slow": "20000000000",
    "standard": "25000000000",
    "fast": "30000000000"
  },
  "history": [
    {
      "timestamp": "2023-11-15T10:00:00.000Z",
      "average": "25000000000",
      "median": "24000000000",
      "min": "15000000000",
      "max": "50000000000"
    }
  ]
}
```

### 6. 健康检查接口

#### 服务健康检查
```http
GET /api/health
```

**响应示例:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 8ms
X-Service-Version: 1.0.0
X-Health-Check-Time: 2023-11-15T10:30:00.000Z

{
  "status": "healthy",
  "timestamp": "2023-11-15T10:30:00.000Z",
  "version": "1.0.0",
  "uptime": 86400,
  "services": {
    "database": "healthy",
    "ethereum": "healthy",
    "cache": "healthy"
  },
  "metrics": {
    "syncDelay": 2,
    "lastBlock": 18500000,
    "dbSize": "50GB",
    "cacheHitRate": 0.85
  }
}
```

## 错误处理

### 错误代码

| 错误代码 | 含义 | 描述 |
|---------|------|------|
| INVALID_PARAMETER | 参数错误 | 请求参数格式或值不正确 |
| RESOURCE_NOT_FOUND | 资源不存在 | 请求的区块、交易或地址不存在 |
| RATE_LIMIT_EXCEEDED | 频率限制 | 请求频率超过限制 |
| INTERNAL_ERROR | 内部错误 | 服务器内部错误 |
| SERVICE_UNAVAILABLE | 服务不可用 | 数据库或外部服务不可用 |
| SYNC_DELAY | 同步延迟 | 数据同步延迟，请稍后重试 |

### 错误响应示例

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json
X-Request-ID: req_123456789
X-Timestamp: 2023-11-15T10:30:00.000Z

{
  "code": "INVALID_PARAMETER",
  "message": "Invalid Ethereum address format",
  "details": {
    "parameter": "address",
    "value": "invalid_address",
    "expected": "0x prefixed 40 character hex string"
  }
}
```

## 速率限制

### 限制规则

| 级别 | 限制 | 窗口期 | 说明 |
|------|------|--------|------|
| 全局 | 1000次 | 15分钟 | 所有接口总计 |
| IP | 100次 | 1分钟 | 单IP限制 |
| 搜索 | 30次 | 1分钟 | 搜索接口专门限制 |
| 统计 | 10次 | 1分钟 | 统计接口专门限制 |

### 限制响应头

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1699180200
X-RateLimit-Window: 60
```

## 最佳实践

### 1. 分页查询
```javascript
// 推荐：使用适当的分页大小
const response = await fetch('/api/transactions?page=1&limit=20');

// 避免：请求过大的数据集
const response = await fetch('/api/transactions?limit=1000'); // 可能被拒绝
```

### 2. 错误处理
```javascript
try {
  const response = await fetch('/api/blocks/123456');
  const data = await response.json();
  
  if (!data.success) {
    console.error('API Error:', data.error.message);
    return;
  }
  
  // 处理成功数据
  console.log(data.data);
} catch (error) {
  console.error('Network Error:', error);
}
```

### 3. 缓存优化
```javascript
// 利用浏览器缓存
const response = await fetch('/api/blocks/18500000', {
  headers: {
    'Cache-Control': 'public, max-age=3600'
  }
});
```

### 4. 批量查询
```javascript
// 推荐：批量查询多个交易
const hashes = ['0xabc123...', '0xdef456...'];
const promises = hashes.map(hash => 
  fetch(`/api/transactions/${hash}`)
);
const responses = await Promise.all(promises);

// 避免：循环单个查询
for (const hash of hashes) {
  await fetch(`/api/transactions/${hash}`); // 效率低
}
```

## 更新日志

### v1.0.0 (2023-11-15)
- 初始版本发布
- 支持区块、交易、地址基础查询
- 实现搜索功能
- 添加网络统计接口

### 计划更新

#### v1.1.0
- [ ] 添加代币信息接口
- [ ] 支持合约验证状态查询
- [ ] 增加高级搜索过滤
- [ ] WebSocket实时推送

#### v1.2.0
- [ ] 多链支持
- [ ] GraphQL接口
- [ ] 批量查询接口
- [ ] 数据导出功能

---

如有问题或建议，请通过GitHub Issues或邮件联系维护团队。
