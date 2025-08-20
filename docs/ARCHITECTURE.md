# 系统架构设计文档

## 概述

本文档详细描述了以太坊区块链浏览器的系统架构设计，包括技术选型、组件设计、数据流程等。

## 总体架构

### 架构原则

1. **前后端分离**：前端负责展示，后端负责数据处理
2. **低耦合高内聚**：模块间依赖最小化，内部功能聚合
3. **可扩展性**：支持水平扩展和功能扩展
4. **高性能**：优化查询和缓存策略
5. **低成本**：最小化运营成本

### 系统分层

```mermaid
graph TB
    subgraph "Presentation Layer"
        P1[Frontend Static Hosting<br/>Cloudflare Pages]
        P2[React Components<br/>Linaria CSS-in-JS]
        P3[Router Management<br/>React Router v6]
        P4[State Management<br/>Context + Hooks]
    end
    
    subgraph "Service Layer"
        S1[Backend API<br/>Hono Framework]
        S2[Local Server<br/>Node.js Runtime]
        S3[Auto Discovery<br/>Port Scanning]
        S4[API Gateway<br/>Request Routing]
    end
    
    subgraph "Business Layer"
        B1[Data Processing<br/>On-demand Sync]
        B2[Indexing Service<br/>Smart Caching]
        B3[Search Engine<br/>Full-text Search]
        B4[Analytics Service<br/>Statistics Calc]
    end
    
    subgraph "Data Layer"
        D1[DuckDB<br/>OLAP Database]
        D2[File Storage<br/>Local Cache]
        D3[Memory Cache<br/>In-process]
        D4[Config Storage<br/>User Preferences]
    end
    
    subgraph "Infrastructure Layer"
        I1[Ethereum Node<br/>JSON-RPC API]
        I2[External APIs<br/>Price/Gas Data]
        I3[CDN<br/>Static Assets]
        I4[DNS<br/>Domain Resolution]
    end
    
    P1 --> S1
    P2 --> S2
    P3 --> S3
    P4 --> S4
    
    S1 --> B1
    S2 --> B2
    S3 --> B3
    S4 --> B4
    
    B1 --> D1
    B2 --> D2
    B3 --> D3
    B4 --> D4
    
    D1 --> I1
    D2 --> I2
    D3 --> I3
    D4 --> I4
    
    style P1 fill:#e3f2fd
    style S1 fill:#f3e5f5
    style B1 fill:#e8f5e8
    style D1 fill:#fff8e1
    style I1 fill:#fce4ec
```

## 技术选型分析

### 前端技术选型

#### React + Vite 选择理由
- **现代化构建**：Vite 提供极快的开发服务器和构建速度
- **ESM原生支持**：利用现代浏览器的原生ES模块
- **开发体验**：热模块替换(HMR)，瞬间反馈
- **插件生态**：丰富的Vite插件生态系统
- **Tree Shaking**：优秀的代码分割和摇树优化

#### Linaria 选择理由
- **零运行时**：编译时CSS-in-JS，无运行时开销
- **类型安全**：TypeScript支持，编译时样式检查
- **原子化CSS**：支持原子化样式，减少包体积
- **SSR友好**：完美支持服务端渲染
- **性能优秀**：生成的CSS体积小，加载快

### 后端技术选型

#### Hono 选择理由
- **超轻量级**：体积极小，适合边缘计算
- **高性能**：基于Web标准API，性能优秀
- **TypeScript支持**：完整的类型安全支持
- **中间件生态**：丰富的中间件系统
- **跨平台**：支持Node.js、Cloudflare Workers、Deno等多种运行时

#### DuckDB 选择理由
- **OLAP优化**：专为分析查询设计
- **列式存储**：高压缩率，快速聚合
- **零配置**：嵌入式数据库，无需额外配置
- **SQL兼容**：完整的SQL语法支持

## 多链支持架构

### 多链架构概览

```mermaid
graph TB
    subgraph "Frontend Layer"
        F1[Chain Selector<br/>链选择器]
        F2[Unified Interface<br/>统一界面]
        F3[Chain-specific Components<br/>链特定组件]
    end
    
    subgraph "API Gateway Layer"
        G1[Chain Router<br/>链路由器]
        G2[Unified API<br/>统一API接口]
        G3[Chain Adapters<br/>链适配器]
    end
    
    subgraph "Service Layer"
        S1[Ethereum Service<br/>以太坊服务]
        S2[Polygon Service<br/>Polygon服务]
        S3[BSC Service<br/>BSC服务]
        S4[Arbitrum Service<br/>Arbitrum服务]
        S5[Base Service<br/>Base服务]
    end
    
    subgraph "Data Layer"
        D1[Ethereum DB<br/>eth_data.db]
        D2[Polygon DB<br/>polygon_data.db]
        D3[BSC DB<br/>bsc_data.db]
        D4[Arbitrum DB<br/>arbitrum_data.db]
        D5[Base DB<br/>base_data.db]
    end
    
    subgraph "RPC Layer"
        R1[Ethereum RPC<br/>mainnet]
        R2[Polygon RPC<br/>polygon]
        R3[BSC RPC<br/>bsc]
        R4[Arbitrum RPC<br/>arbitrum]
        R5[Base RPC<br/>base]
    end
    
    F1 --> G1
    F2 --> G2
    F3 --> G3
    
    G1 --> S1
    G1 --> S2
    G1 --> S3
    G1 --> S4
    G1 --> S5
    
    S1 --> D1
    S1 --> R1
    S2 --> D2
    S2 --> R2
    S3 --> D3
    S3 --> R3
    S4 --> D4
    S4 --> R4
    S5 --> D5
    S5 --> R5
    
    style F1 fill:#e3f2fd
    style G1 fill:#f3e5f5
    style S1 fill:#e8f5e8
    style D1 fill:#fff8e1
    style R1 fill:#fce4ec
```

### 支持的区块链网络

| 网络 | Chain ID | 符号 | RPC配置 | 数据库 |
|------|----------|------|---------|--------|
| **Ethereum** | 1 | ETH | mainnet | eth_data.db |
| **Polygon** | 137 | MATIC | polygon | polygon_data.db |
| **BSC** | 56 | BNB | bsc | bsc_data.db |
| **Arbitrum** | 42161 | ETH | arbitrum | arbitrum_data.db |
| **Base** | 8453 | ETH | base | base_data.db |
| **Optimism** | 10 | ETH | optimism | optimism_data.db |

### 链抽象层设计

#### 统一的链接口
```typescript
// src/shared/types/chain.ts
export interface ChainConfig {
  chainId: number;
  name: string;
  symbol: string;
  rpcUrl: string;
  explorerUrl?: string;
  blockTime: number; // 平均出块时间(秒)
  database: string;  // 数据库文件名
  features: ChainFeatures;
}

export interface ChainFeatures {
  supportsEIP1559: boolean;  // 支持 EIP-1559
  supportsTrace: boolean;    // 支持 trace 调用
  supportsDebug: boolean;    // 支持 debug 调用
  hasNativeToken: boolean;   // 是否有原生代币
  supportsContracts: boolean; // 支持智能合约
}

export interface ChainMetrics {
  latestBlock: number;
  avgBlockTime: number;
  avgGasPrice: string;
  tps: number; // 每秒交易数
  totalTransactions: number;
}
```

## 组件设计

### Monorepo 组件架构

```mermaid
graph TB
    subgraph "src/"
        subgraph "shared/ 共享代码"
            S1[types/<br/>api.ts, blockchain.ts, common.ts]
            S2[utils/<br/>format.ts, validation.ts, crypto.ts]
            S3[constants/<br/>api.ts, blockchain.ts, config.ts]
            S4[validation/<br/>schemas.ts, rules.ts]
        end
        
        subgraph "client/ 前端代码"
            C1[pages/<br/>Home, Blocks, Transactions, Addresses, Search]
            C2[components/<br/>ui, blocks, transactions, addresses, charts, layout]
            C3[hooks/<br/>useApi, useSearch, useLocalStorage]
            C4[api/<br/>client, blocks, transactions, addresses]
            C5[styles/<br/>globals, theme, components]
            C6[main.tsx<br/>前端入口]
        end
        
        subgraph "server/ 后端代码"
            SE1[routes/<br/>blocks, transactions, addresses, search, stats]
            SE2[services/<br/>BlockService, TransactionService, AddressService, SyncService]
            SE3[database/<br/>connection, migrations, queries, indexes]
            SE4[middleware/<br/>auth, rateLimit, cors, error]
            SE5[utils/<br/>ethereum, logger, cache]
            SE6[app.ts<br/>后端入口]
        end
        
        subgraph "scripts/ 构建脚本"
            SC1[build.ts<br/>构建脚本]
            SC2[dev.ts<br/>开发脚本]
            SC3[deploy.ts<br/>部署脚本]
        end
    end
    
    S1 --> C4
    S1 --> SE1
    S2 --> C3
    S2 --> SE2
    S3 --> C5
    S3 --> SE3
    S4 --> SE4
    
    C1 --> C6
    C2 --> C6
    C3 --> C6
    C4 --> C6
    C5 --> C6
    
    SE1 --> SE6
    SE2 --> SE6
    SE3 --> SE6
    SE4 --> SE6
    SE5 --> SE6
    
    style S1 fill:#e8eaf6
    style C1 fill:#e1f5fe
    style SE1 fill:#f3e5f5
    style SC1 fill:#e8f5e8
```

### 共享代码优势

采用 Monorepo 结构的主要优势：

1. **类型共享**：前后端使用相同的类型定义，确保数据一致性
2. **工具复用**：格式化、验证等工具函数可以在前后端复用
3. **常量统一**：API路径、配置项等常量集中管理
4. **代码同步**：前后端代码变更可以同步进行，减少版本不一致问题
5. **构建优化**：可以实现增量构建和智能缓存

### 类型共享示例

```typescript
// src/shared/types/api.ts
// 成功响应：直接返回数据
export type DataResponse<T> = T;

// 列表响应：包含数据和分页信息
export type ListResponse<T> = {
  data: T[];
  pagination: PaginationInfo;
};

// 错误响应：简化结构
export type ErrorResponse = {
  code: string;
  message: string;
  details?: any;
};

export type PaginationInfo = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

// src/shared/types/blockchain.ts  
export type Block = {
  chainId: number;       // 新增：链ID
  number: number;
  hash: string;
  parentHash: string;
  timestamp: string;
  miner: string;
  gasLimit: string;
  gasUsed: string;
  baseFeePerGas?: string; // 新增：EIP-1559基础费用
  transactionCount: number;
  network: string;       // 新增：网络名称
  // ... 其他字段
};

export type Transaction = {
  chainId: number;       // 新增：链ID
  hash: string;
  blockNumber: number;
  transactionIndex: number;
  from: string;
  to: string | null;
  value: string;
  gasLimit: string;
  gasPrice?: string;     // Legacy 交易
  maxFeePerGas?: string; // EIP-1559 交易
  maxPriorityFeePerGas?: string; // EIP-1559 交易
  gasUsed: string;
  status: number;
  timestamp: string;
  network: string;       // 新增：网络名称
  type: number;          // 新增：交易类型 (0, 1, 2)
};

export type Address = {
  chainId: number;       // 新增：链ID
  address: string;
  balance: string;
  transactionCount: number;
  isContract: boolean;
  network: string;       // 新增：网络名称
  label?: string;        // 用户自定义标签
};

// 前端使用 - 多链支持
// src/client/api/blocks.ts
import type { DataResponse, Block } from '../../shared/types/index.js';

export async function getLatestBlock(chainId: number = 1): Promise<DataResponse<Block>> {
  // 多链API调用，通过chainId参数指定链
  const response = await fetch(`/api/chains/${chainId}/blocks/latest`);
  if (!response.ok) {
    const error: ErrorResponse = await response.json();
    throw new Error(error.message);
  }
  return response.json(); // 直接返回Block数据，包含chainId
}

export async function getBlockByNumber(
  chainId: number, 
  blockNumber: number
): Promise<DataResponse<Block>> {
  const response = await fetch(`/api/chains/${chainId}/blocks/${blockNumber}`);
  if (!response.ok) {
    const error: ErrorResponse = await response.json();
    throw new Error(error.message);
  }
  return response.json();
}

// 后端使用 - 多链路由  
// src/server/routes/blocks.ts
import { Context } from 'hono';
import type { DataResponse, Block } from '../../shared/types/index.js';
import { ChainService } from '../services/ChainService.js';

export async function handleGetLatestBlock(c: Context): Promise<Response> {
  const chainId = parseInt(c.req.param('chainId'));
  const chainService = new ChainService(chainId);
  
  const block = await chainService.getLatestBlock();
  
  // 设置响应头（元数据）
  c.header('X-Response-Time', '25ms');
  c.header('X-Data-Source', 'database');
  c.header('X-Chain-ID', chainId.toString());
  c.header('X-Network', block.network);
  
  // 直接返回数据，无包装
  return c.json(block);
}
```

## 数据流设计

### 简化的数据策略

基于用户访问驱动的混合数据源架构，彻底简化数据同步策略：

#### 混合数据源架构

```mermaid
graph TB
    subgraph "Data Sources 数据源分类"
        subgraph "Real-time Data 实时数据"
            RT1[Latest Block<br/>最新区块]
            RT2[Current Balance<br/>当前余额]
            RT3[Gas Price<br/>Gas价格]
            RT4[Transaction Status<br/>交易状态]
            RT5[Network Stats<br/>网络统计]
        end
        
        subgraph "Historical Data 历史数据"
            HT1[Block History<br/>区块历史]
            HT2[Transaction History<br/>交易历史]
            HT3[Address Activity<br/>地址活动]
            HT4[Token Transfers<br/>代币转账]
            HT5[Search Results<br/>搜索结果]
        end
    end
    
    subgraph "Data Flow 数据流程"
        subgraph "Browser Direct 浏览器直接调用"
            B1[Viem Client<br/>前端RPC客户端]
            B2[Public RPC<br/>公共RPC节点]
        end
        
        subgraph "Local Server 本地服务器"
            L1[API Gateway<br/>API网关]
            L2[On-demand Sync<br/>按需同步]
            L3[Smart Cache<br/>智能缓存]
        end
        
        subgraph "Storage Layer 存储层"
            S1[Memory Cache<br/>内存缓存]
            S2[DuckDB<br/>本地数据库]
            S3[Access History<br/>访问历史]
        end
    end
    
    RT1 --> B1
    RT2 --> B1
    RT3 --> B1
    RT4 --> B1
    RT5 --> B1
    
    B1 --> B2
    
    HT1 --> L1
    HT2 --> L1
    HT3 --> L1
    HT4 --> L1
    HT5 --> L1
    
    L1 --> L2
    L2 --> L3
    L3 --> S1
    L3 --> S2
    L2 --> S3
    
    L2 -.->|Fallback to RPC| B2
    
    style RT1 fill:#e3f2fd
    style HT1 fill:#f3e5f5
    style B1 fill:#e8f5e8
    style L1 fill:#fff8e1
    style S1 fill:#fce4ec
```

### 用户访问驱动的数据同步流程

```mermaid
sequenceDiagram
    participant U as User Browser
    participant P as Port Scanner
    participant A as API Server
    participant S as Sync Service
    participant E as Ethereum RPC
    participant D as DuckDB
    participant C as Memory Cache

    Note over U,C: 用户访问驱动的按需同步流程

    U->>P: 访问页面
    P->>A: 扫描本地端口 (8000-8010)
    
    alt Local Server Found
        A-->>P: 发现服务 (如:8005)
        P-->>U: 连接本地服务
        
        U->>A: 请求数据 (GET /api/blocks/18500000)
        A->>S: 调用同步服务
        
        S->>C: 检查内存缓存
        alt Cache Hit
            C-->>S: 返回缓存数据
            S-->>A: 返回数据 (source: cache)
        else Cache Miss
            S->>D: 检查本地数据库
            alt DB Hit
                D-->>S: 返回存储数据
                S->>C: 更新缓存
                S-->>A: 返回数据 (source: database)
            else DB Miss
                S->>E: 访问时同步获取
                E-->>S: 返回区块数据
                S->>D: 异步存储数据
                S->>C: 更新缓存
                S-->>A: 返回数据 (source: rpc)
            end
        end
        A-->>U: 返回响应 + 元数据头
        
    else Local Server Not Found
        P-->>U: 显示安装引导
        U->>U: 选择安装脚本或配置远程API
        alt Use Remote API
            U->>E: 直接RPC调用获取实时数据
            E-->>U: 返回实时数据
        end
    end
```

### 地址交易查询策略

基于标准RPC的轻量级地址交易查询方案，无需依赖外部API或全量索引。

#### 核心思路

利用 `getTransactionCount` 和余额变化的二分查找算法，在有限的RPC调用次数内定位地址相关的交易。

```mermaid
graph TD
    A[开始查询地址交易] --> B[获取基础信息]
    B --> B1[getTransactionCount<br/>获取发送交易数量]
    B --> B2[getBalance at latest<br/>获取当前余额]
    
    B1 --> C{交易数量 > 0?}
    C -->|是| D[二分查找发送交易]
    C -->|否| E[仅查找接收交易]
    
    D --> D1[获取历史余额快照]
    E --> D1
    D1 --> D2[binary search<br/>定位余额变化区间]
    D2 --> D3[在区间内查找具体交易]
    
    D3 --> F{找到足够交易?}
    F -->|是| G[返回交易列表]
    F -->|否| H[请求用户提供线索]
    
    H --> H1[时间范围输入]
    H --> H2[区块范围输入]
    H --> H3[跳转到外部浏览器]
    
    H1 --> I[缩小搜索范围]
    H2 --> I
    I --> D2
    
    style A fill:#e3f2fd
    style G fill:#c8e6c9
    style H3 fill:#ffcdd2
```

#### 算法实现

##### 1. 基础信息收集
```typescript
// 获取地址基础信息
async function getAddressBasicInfo(address: string): Promise<{
  transactionCount: number;
  currentBalance: bigint;
  latestBlock: number;
}> {
  const [txCount, balance, latestBlock] = await Promise.all([
    rpcClient.getTransactionCount(address),
    rpcClient.getBalance(address),
    rpcClient.getBlockNumber()
  ]);
  
  return { transactionCount: txCount, currentBalance: balance, latestBlock };
}
```

##### 2. 二分查找余额变化
```typescript
// 二分查找余额变化的区块范围
async function findBalanceChangeBlocks(
  address: string, 
  startBlock: number, 
  endBlock: number,
  maxAttempts: number = 20
): Promise<{ blockNumber: number; balance: bigint }[]> {
  const changes: { blockNumber: number; balance: bigint }[] = [];
  const visited = new Set<number>();
  
  async function binarySearch(start: number, end: number, depth: number = 0) {
    if (depth >= maxAttempts || end - start <= 1) return;
    
    const mid = Math.floor((start + end) / 2);
    if (visited.has(mid)) return;
    visited.add(mid);
    
    const [startBalance, midBalance, endBalance] = await Promise.all([
      rpcClient.getBalance(address, start),
      rpcClient.getBalance(address, mid),
      rpcClient.getBalance(address, end)
    ]);
    
    // 检查余额变化
    if (startBalance !== midBalance) {
      changes.push({ blockNumber: mid, balance: midBalance });
      await binarySearch(start, mid, depth + 1);
    }
    
    if (midBalance !== endBalance) {
      changes.push({ blockNumber: mid, balance: midBalance });
      await binarySearch(mid, end, depth + 1);
    }
  }
  
  await binarySearch(startBlock, endBlock);
  return changes.sort((a, b) => b.blockNumber - a.blockNumber);
}
```

##### 3. 交易定位与提取
```typescript
// 在指定区块范围内查找地址相关交易
async function findTransactionsInRange(
  address: string,
  startBlock: number,
  endBlock: number
): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  const maxBlocks = Math.min(endBlock - startBlock, 100); // 限制查找范围
  
  for (let i = 0; i < maxBlocks; i++) {
    const blockNumber = endBlock - i;
    if (blockNumber < startBlock) break;
    
    try {
      const block = await rpcClient.getBlock(blockNumber, true);
      if (!block?.transactions) continue;
      
      // 筛选与目标地址相关的交易
      const relatedTxs = block.transactions.filter(tx => 
        tx.from?.toLowerCase() === address.toLowerCase() ||
        tx.to?.toLowerCase() === address.toLowerCase()
      );
      
      transactions.push(...relatedTxs);
    } catch (error) {
      console.warn(`Failed to fetch block ${blockNumber}:`, error);
    }
  }
  
  return transactions;
}
```

#### 用户交互策略

##### 1. 渐进式搜索体验
```typescript
// 分阶段搜索策略
const searchPhases = [
  {
    name: "快速搜索",
    maxAttempts: 10,
    blockRange: 1000,
    description: "搜索最近1000个区块"
  },
  {
    name: "扩展搜索", 
    maxAttempts: 20,
    blockRange: 10000,
    description: "扩展到最近10000个区块"
  },
  {
    name: "用户辅助搜索",
    requiresInput: true,
    description: "请提供时间范围或区块范围"
  }
];
```

##### 2. 用户输入辅助
```typescript
type SearchHint = {
  timeRange?: { start: Date; end: Date };
  blockRange?: { start: number; end: number };
  transactionHash?: string;
  knownActivity?: 'defi' | 'nft' | 'transfer';
};

// 根据用户提示优化搜索
async function searchWithHints(
  address: string, 
  hints: SearchHint
): Promise<Transaction[]> {
  if (hints.transactionHash) {
    // 直接查询已知交易
    return await getTransactionDetails(hints.transactionHash);
  }
  
  if (hints.timeRange) {
    // 时间范围转换为区块范围
    const blockRange = await timeToBlockRange(hints.timeRange);
    return await findTransactionsInRange(address, blockRange.start, blockRange.end);
  }
  
  if (hints.blockRange) {
    // 直接使用区块范围
    return await findTransactionsInRange(address, hints.blockRange.start, hints.blockRange.end);
  }
  
  // 默认搜索策略
  return await performDefaultSearch(address);
}
```

#### 局限性与应对策略

##### 1. 技术局限性
- **合约地址**: 无法通过 `getTransactionCount` 检测接收交易
- **复杂交易**: DeFi、NFT等内部转账难以检测
- **性能限制**: 大量RPC调用可能导致延迟

##### 2. 用户体验优化
```typescript
// 结果展示策略
type SearchResult = {
  transactions: Transaction[];
  searchMethod: 'binary_search' | 'user_hint' | 'partial';
  completeness: 'complete' | 'partial' | 'unknown';
  suggestions: string[];
  externalLinks: {
    etherscan: string;
    blockscout?: string;
    [key: string]: string;
  };
};

// 提供外部浏览器链接
function generateExternalLinks(address: string, chainId: number): ExternalLinks {
  const links: ExternalLinks = {};
  
  switch (chainId) {
    case 1: // Ethereum Mainnet
      links.etherscan = `https://etherscan.io/address/${address}`;
      break;
    case 137: // Polygon
      links.polygonscan = `https://polygonscan.com/address/${address}`;
      break;
    case 56: // BSC
      links.bscscan = `https://bscscan.com/address/${address}`;
      break;
    // ... 其他链
  }
  
  return links;
}
```

##### 3. 错误处理与降级
```typescript
// 智能降级策略
async function searchAddressTransactions(
  address: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  try {
    // 尝试二分查找
    const result = await binarySearchTransactions(address, options);
    if (result.transactions.length > 0) {
      return {
        ...result,
        searchMethod: 'binary_search',
        completeness: 'partial'
      };
    }
  } catch (error) {
    console.warn('Binary search failed:', error);
  }
  
  // 降级到用户辅助
  return {
    transactions: [],
    searchMethod: 'user_hint',
    completeness: 'unknown',
    suggestions: [
      '请提供大概的交易时间',
      '如果知道具体交易哈希，请直接搜索',
      '点击下方链接查看完整交易历史'
    ],
    externalLinks: generateExternalLinks(address, options.chainId || 1)
  };
}
```

#### 性能优化

##### 1. 请求批量化
```typescript
// 批量RPC请求优化
async function batchGetBalances(
  address: string, 
  blockNumbers: number[]
): Promise<Map<number, bigint>> {
  const batchSize = 10; // 每批请求数量
  const results = new Map<number, bigint>();
  
  for (let i = 0; i < blockNumbers.length; i += batchSize) {
    const batch = blockNumbers.slice(i, i + batchSize);
    const balances = await Promise.all(
      batch.map(block => rpcClient.getBalance(address, block))
    );
    
    batch.forEach((block, index) => {
      results.set(block, balances[index]);
    });
  }
  
  return results;
}
```

##### 2. 智能缓存
```typescript
// 地址查询结果缓存
const addressSearchCache = new Map<string, {
  result: SearchResult;
  timestamp: number;
  blockHeight: number;
}>();

// 缓存策略：按地址+区块高度缓存
function getCacheKey(address: string, blockHeight: number): string {
  return `${address}:${Math.floor(blockHeight / 1000) * 1000}`; // 1000区块粒度
}
```

这种轻量级的地址交易查询策略在保持系统简单性的同时，为用户提供了实用的交易查找功能，并通过渐进式搜索和外部链接确保良好的用户体验。

### 合约事件索引策略

针对合约地址，采用基于事件日志的索引策略，提供高级事件过滤和分析能力。

#### 核心思路

合约地址的交易查询以事件索引为主导，通过 `eth_getLogs` API 高效查询事件日志，再关联对应的交易详情。

```mermaid
graph TD
    A[合约地址查询] --> B[地址类型检测]
    B --> B1{是否为合约?}
    B1 -->|否| C[使用普通地址策略]
    B1 -->|是| D[合约事件查询策略]
    
    D --> D1[获取合约ABI]
    D1 --> D2[解析事件定义]
    D2 --> D3[构建事件过滤器]
    D3 --> D4[批量查询事件日志]
    D4 --> D5[解析事件参数]
    D5 --> D6[关联交易详情]
    
    D1 --> E1[Etherscan API]
    D1 --> E2[本地ABI库]
    D1 --> E3[用户上传ABI]
    D1 --> E4[事件签名推断]
    
    D6 --> F[返回结构化事件数据]
    
    style A fill:#e3f2fd
    style F fill:#c8e6c9
    style C fill:#ffecb3
```

#### ABI获取与管理

采用简化的三源策略：Sourcify + 标准合约库 + 用户上传，避免复杂的推断算法。

##### 1. 简化的ABI获取策略

```typescript
// 简化的ABI管理器
class SimpleAbiManager {
  async getContractAbi(address: string, chainId: number): Promise<{
    abi: any[];
    source: 'sourcify' | 'standard' | 'user';
    verified: boolean;
  }> {
    // 1. 优先检查用户已上传/选择的ABI
    const userAbi = await this.getUserAbi(address, chainId);
    if (userAbi) {
      return { abi: userAbi, source: 'user', verified: true };
    }

    // 2. 尝试Sourcify（免费的去中心化验证服务）
    try {
      const sourcifyAbi = await this.getFromSourcery(address, chainId);
      return { abi: sourcifyAbi, source: 'sourcify', verified: true };
    } catch (error) {
      console.log('Sourcify未找到合约ABI:', error.message);
    }

    // 3. 检查是否匹配标准合约
    const standardAbi = await this.matchStandardContract(address, chainId);
    if (standardAbi) {
      return { abi: standardAbi, source: 'standard', verified: false };
    }

    // 4. 都找不到，返回错误提示用户上传
    throw new Error('ABI_NOT_FOUND');
  }
}
```

##### 2. Sourcify集成（主要数据源）

```typescript
class SourceryProvider {
  private readonly BASE_URL = 'https://sourcify.dev/server';

  async getVerifiedAbi(address: string, chainId: number): Promise<any[]> {
    try {
      // 检查合约是否已验证
      const checkResponse = await fetch(`${this.BASE_URL}/check-by-addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addresses: [address],
          chainIds: [chainId.toString()]
        })
      });
      
      const checkResult = await checkResponse.json();
      if (!checkResult[0] || checkResult[0].status !== 'perfect') {
        throw new Error('Contract not verified in Sourcify');
      }

      // 获取合约元数据
      const filesResponse = await fetch(
        `${this.BASE_URL}/files/any/${chainId}/${address}`
      );
      const files = await filesResponse.json();
      
      const metadataFile = files.find(f => f.name.endsWith('metadata.json'));
      if (!metadataFile) {
        throw new Error('Metadata not found');
      }

      const metadataResponse = await fetch(metadataFile.url);
      const metadata = await metadataResponse.json();
      
      return metadata.output.abi;
    } catch (error) {
      throw new Error(`Sourcify ABI获取失败: ${error.message}`);
    }
  }
}
```

##### 3. 基于viem的标准合约库

```typescript
// 使用viem内置的ABI定义
import { 
  erc20Abi, 
  erc721Abi, 
  erc1155Abi 
} from 'viem';

// 扩展viem的标准ABI库
const VIEM_STANDARD_CONTRACTS = {
  'ERC20': {
    abi: erc20Abi,
    selectors: [
      '0x70a08231', // balanceOf
      '0xa9059cbb', // transfer  
      '0x23b872dd', // transferFrom
      '0x095ea7b3'  // approve
    ]
  },
  
  'ERC721': {
    abi: erc721Abi,
    selectors: [
      '0x70a08231', // balanceOf
      '0x6352211e', // ownerOf
      '0x23b872dd', // transferFrom
      '0xa22cb465'  // setApprovalForAll
    ]
  },
  
  'ERC1155': {
    abi: erc1155Abi,
    selectors: [
      '0x00fdd58e', // balanceOf
      '0x4e1273f4', // balanceOfBatch
      '0xf242432a', // safeTransferFrom
      '0x2eb2c2d6'  // safeBatchTransferFrom
    ]
  }
};

// DeFi协议ABI（手动定义的常用协议）
const DEFI_CONTRACTS = {
  'UniswapV2Pair': {
    abi: [
      {
        "name": "Swap",
        "type": "event",
        "inputs": [
          {"name": "sender", "type": "address", "indexed": true},
          {"name": "amount0In", "type": "uint256", "indexed": false},
          {"name": "amount1In", "type": "uint256", "indexed": false},
          {"name": "amount0Out", "type": "uint256", "indexed": false},
          {"name": "amount1Out", "type": "uint256", "indexed": false},
          {"name": "to", "type": "address", "indexed": true}
        ]
      },
      {
        "name": "getReserves",
        "type": "function",
        "inputs": [],
        "outputs": [
          {"name": "reserve0", "type": "uint112"},
          {"name": "reserve1", "type": "uint112"},
          {"name": "blockTimestampLast", "type": "uint32"}
        ],
        "stateMutability": "view"
      }
    ],
    selectors: ['0x0902f1ac', '0x4f1eb3d8', '0xba9a7a56']
  }
};

// 合并所有标准合约
const ALL_STANDARD_CONTRACTS = {
  ...VIEM_STANDARD_CONTRACTS,
  ...DEFI_CONTRACTS
};

// 智能合约检测服务
class ContractStandardDetector {
  async detectStandard(address: string, chainId: number): Promise<string[]> {
    const detectedStandards = [];
    
    for (const [standard, config] of Object.entries(ALL_STANDARD_CONTRACTS)) {
      try {
        const isMatch = await this.checkContractInterface(address, config.selectors, chainId);
        if (isMatch) {
          detectedStandards.push(standard);
        }
      } catch (error) {
        console.warn(`Failed to check ${standard} for ${address}:`, error);
      }
    }
    
    return detectedStandards;
  }

  private async checkContractInterface(
    address: string, 
    selectors: string[], 
    chainId: number
  ): Promise<boolean> {
    const rpcClient = await this.rpcManager.getClient(chainId);
    
    // 检查合约是否支持这些函数选择器
    let matchCount = 0;
    
    for (const selector of selectors) {
      try {
        // 尝试调用静态函数检查是否存在
        const result = await rpcClient.call({
          to: address as `0x${string}`,
          data: selector as `0x${string}`
        });
        
        // 如果没有抛出错误，说明函数存在
        if (result) {
          matchCount++;
        }
      } catch (error) {
        // 函数不存在或调用失败
      }
    }
    
    // 如果匹配数量超过阈值，认为是该标准的合约
    return matchCount >= Math.ceil(selectors.length * 0.6);
  }

  getStandardAbi(standard: string): any[] {
    return ALL_STANDARD_CONTRACTS[standard]?.abi || [];
  }
}
```

##### 4. 用户ABI管理

```typescript
// 用户ABI存储管理
class UserAbiStorage {
  private readonly STORAGE_KEY = 'user_contract_abis';

  // 保存用户上传的ABI
  saveUserAbi(address: string, chainId: number, abi: any[], name?: string): void {
    const key = `${chainId}:${address.toLowerCase()}`;
    const userAbis = this.getUserAbis();
    
    userAbis[key] = {
      abi,
      name: name || `Contract ${address.slice(0, 8)}...`,
      uploadedAt: Date.now(),
      address: address.toLowerCase(),
      chainId
    };
    
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(userAbis));
  }

  // 获取用户ABI
  getUserAbi(address: string, chainId: number): any[] | null {
    const key = `${chainId}:${address.toLowerCase()}`;
    const userAbis = this.getUserAbis();
    return userAbis[key]?.abi || null;
  }

  // 获取所有用户ABI
  getUserAbis(): Record<string, UserAbiRecord> {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      return {};
    }
  }

  // 删除用户ABI
  removeUserAbi(address: string, chainId: number): void {
    const key = `${chainId}:${address.toLowerCase()}`;
    const userAbis = this.getUserAbis();
    delete userAbis[key];
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(userAbis));
  }
}

type UserAbiRecord = {
  abi: any[];
  name: string;
  uploadedAt: number;
  address: string;
  chainId: number;
};
```

#### 事件查询与过滤系统

##### 1. 高级事件过滤器

```typescript
// 事件过滤器配置
type EventFilter = {
  contractAddress: string;
  chainId: number;
  eventNames?: string[];           // 事件名称过滤
  topics?: (string | string[])[];  // 主题过滤
  fromBlock?: number | 'latest';   // 起始区块
  toBlock?: number | 'latest';     // 结束区块
  paramFilters?: {                 // 参数过滤
    [paramName: string]: {
      operator: 'eq' | 'gt' | 'lt' | 'in' | 'contains';
      value: any;
    };
  };
  timeRange?: {                    // 时间范围过滤
    start: Date;
    end: Date;
  };
  limit?: number;                  // 结果限制
  offset?: number;                 // 偏移量
};

// 事件查询服务
class EventQueryService {
  async queryContractEvents(filter: EventFilter): Promise<{
    events: ParsedEvent[];
    total: number;
    hasMore: boolean;
  }> {
    // 1. 获取合约ABI
    const abiInfo = await this.abiManager.getContractAbi({
      contractAddress: filter.contractAddress,
      chainId: filter.chainId,
      preferredSources: ['local', 'etherscan', 'inferred'],
      fallbackEnabled: true,
      cacheExpiry: 24 // 24小时缓存
    });

    // 2. 构建事件签名映射
    const eventSignatures = this.buildEventSignatures(abiInfo.abi);

    // 3. 转换为eth_getLogs参数
    const logFilter = await this.buildLogFilter(filter, eventSignatures);

    // 4. 批量查询事件日志
    const logs = await this.fetchEventLogs(logFilter);

    // 5. 解析事件参数
    const parsedEvents = await this.parseEventLogs(logs, abiInfo.abi);

    // 6. 应用高级过滤
    const filteredEvents = this.applyAdvancedFilters(parsedEvents, filter);

    // 7. 分页处理
    const paginatedResult = this.paginateResults(filteredEvents, filter);

    return paginatedResult;
  }

  private buildEventSignatures(abi: any[]): Map<string, any> {
    const signatures = new Map();
    
    abi.filter(item => item.type === 'event').forEach(event => {
      const signature = this.getEventSignature(event);
      signatures.set(signature, event);
    });

    return signatures;
  }

  private getEventSignature(event: any): string {
    const inputs = event.inputs.map((input: any) => input.type).join(',');
    return keccak256(`${event.name}(${inputs})`);
  }

  private async buildLogFilter(
    filter: EventFilter, 
    eventSignatures: Map<string, any>
  ): Promise<any> {
    const logFilter: any = {
      address: filter.contractAddress,
      fromBlock: filter.fromBlock || 'earliest',
      toBlock: filter.toBlock || 'latest'
    };

    // 构建topics过滤器
    if (filter.eventNames && filter.eventNames.length > 0) {
      const eventTopics = filter.eventNames.map(name => {
        const matchingSignature = Array.from(eventSignatures.entries())
          .find(([_, event]) => event.name === name)?.[0];
        return matchingSignature;
      }).filter(Boolean);

      if (eventTopics.length > 0) {
        logFilter.topics = [eventTopics];
      }
    }

    // 时间范围转换为区块范围
    if (filter.timeRange) {
      const blockRange = await this.timeToBlockRange(filter.timeRange, filter.chainId);
      logFilter.fromBlock = Math.max(logFilter.fromBlock || 0, blockRange.start);
      logFilter.toBlock = Math.min(logFilter.toBlock || blockRange.end, blockRange.end);
    }

    return logFilter;
  }
}
```

##### 2. 事件解析与数据结构

```typescript
// 解析后的事件数据结构
type ParsedEvent = {
  eventName: string;
  eventSignature: string;
  contractAddress: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  timestamp: Date;
  gasUsed?: number;
  gasPrice?: string;
  
  // 解析后的参数
  args: {
    [paramName: string]: {
      value: any;
      type: string;
      indexed: boolean;
      formatted?: string; // 格式化后的可读值
    };
  };
  
  // 原始数据
  raw: {
    topics: string[];
    data: string;
  };
  
  // 关联交易信息
  transaction?: {
    from: string;
    to: string;
    value: string;
    status: number;
  };
};

// 事件解析器
class EventParser {
  parseEventLog(log: any, eventAbi: any): ParsedEvent {
    const iface = new Interface([eventAbi]);
    const parsed = iface.parseLog(log);

    const args: ParsedEvent['args'] = {};
    
    // 解析事件参数
    eventAbi.inputs.forEach((input: any, index: number) => {
      const value = parsed.args[index];
      args[input.name] = {
        value: value,
        type: input.type,
        indexed: input.indexed,
        formatted: this.formatValue(value, input.type)
      };
    });

    return {
      eventName: eventAbi.name,
      eventSignature: parsed.signature,
      contractAddress: log.address,
      blockNumber: parseInt(log.blockNumber, 16),
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      transactionIndex: parseInt(log.transactionIndex, 16),
      logIndex: parseInt(log.logIndex, 16),
      timestamp: new Date(), // 需要从区块获取
      args,
      raw: {
        topics: log.topics,
        data: log.data
      }
    };
  }

  private formatValue(value: any, type: string): string {
    switch (type) {
      case 'address':
        return value.toLowerCase();
      case 'uint256':
      case 'uint128':
        return this.formatTokenAmount(value);
      case 'bytes32':
        return this.formatBytes32(value);
      default:
        return value.toString();
    }
  }

  private formatTokenAmount(value: bigint): string {
    // 根据代币精度格式化数值
    return ethers.formatUnits(value, 18); // 默认18位精度
  }
}
```

#### 用户界面设计

##### 1. ABI状态显示组件

```typescript
// ABI状态组件
const AbiStatus = ({ address, chainId }: { address: string; chainId: number }) => {
  const [abiInfo, setAbiInfo] = useState<AbiInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAbi();
  }, [address, chainId]);

  const loadAbi = async () => {
    setLoading(true);
    try {
      const info = await abiManager.getContractAbi(address, chainId);
      setAbiInfo(info);
    } catch (error) {
      if (error.message === 'ABI_NOT_FOUND') {
        setAbiInfo(null);
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>正在获取合约ABI...</div>;
  }

  if (!abiInfo) {
    return (
      <div className="abi-not-found">
        <p>🔍 未找到该合约的ABI</p>
        <div className="abi-actions">
          <button onClick={() => showAbiUploadModal(address, chainId)}>
            📁 上传ABI
          </button>
          <button onClick={() => showStandardAbiSelector(address, chainId)}>
            📋 选择标准ABI
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="abi-found">
      <div className="abi-source">
        {abiInfo.source === 'sourcify' && '✅ Sourcify验证'}
        {abiInfo.source === 'standard' && '📋 标准合约'}
        {abiInfo.source === 'user' && '👤 用户上传'}
      </div>
      <div className="abi-stats">
        {abiInfo.abi.filter(item => item.type === 'function').length} 个函数,
        {abiInfo.abi.filter(item => item.type === 'event').length} 个事件
      </div>
    </div>
  );
};
```

##### 2. ABI上传界面

```typescript
// ABI上传组件
const AbiUploadModal = ({ address, chainId, onClose, onSuccess }) => {
  const [abiText, setAbiText] = useState('');
  const [contractName, setContractName] = useState('');
  const [error, setError] = useState('');

  const handleUpload = () => {
    try {
      // 验证ABI格式
      const abi = JSON.parse(abiText);
      if (!Array.isArray(abi)) {
        throw new Error('ABI必须是数组格式');
      }

      // 保存用户ABI
      userAbiStorage.saveUserAbi(address, chainId, abi, contractName);
      
      onSuccess();
      onClose();
    } catch (error) {
      setError(`ABI格式错误: ${error.message}`);
    }
  };

  return (
    <div className="abi-upload-modal">
      <h3>上传合约ABI</h3>
      
      <div className="form-group">
        <label>合约名称（可选）</label>
        <input 
          value={contractName}
          onChange={(e) => setContractName(e.target.value)}
          placeholder="例如：USDC Token"
        />
      </div>

      <div className="form-group">
        <label>ABI JSON</label>
        <textarea 
          value={abiText}
          onChange={(e) => setAbiText(e.target.value)}
          placeholder="粘贴ABI JSON数组..."
          rows={10}
        />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button onClick={handleUpload} disabled={!abiText.trim()}>
          上传
        </button>
      </div>
    </div>
  );
};
```

##### 3. 标准ABI选择器

```typescript
// 标准ABI选择组件
const StandardAbiSelector = ({ address, chainId, onClose, onSuccess }) => {
  const [selectedStandard, setSelectedStandard] = useState('');

  const handleSelect = () => {
    if (!selectedStandard) return;

    const standardAbi = STANDARD_CONTRACTS[selectedStandard].abi;
    userAbiStorage.saveUserAbi(
      address, 
      chainId, 
      standardAbi, 
      `${selectedStandard} Contract`
    );
    
    onSuccess();
    onClose();
  };

  return (
    <div className="standard-abi-selector">
      <h3>选择标准合约ABI</h3>
      
      <div className="standards-list">
        {Object.keys(STANDARD_CONTRACTS).map(standard => (
          <div 
            key={standard}
            className={`standard-item ${selectedStandard === standard ? 'selected' : ''}`}
            onClick={() => setSelectedStandard(standard)}
          >
            <div className="standard-name">{standard}</div>
            <div className="standard-desc">
              {standard === 'ERC20' && '代币合约（Transfer、Approval等）'}
              {standard === 'ERC721' && 'NFT合约（Transfer、TokenURI等）'}
              {standard === 'UniswapV2Pair' && 'Uniswap V2交易对合约'}
            </div>
          </div>
        ))}
      </div>

      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button onClick={handleSelect} disabled={!selectedStandard}>
          选择
        </button>
      </div>
    </div>
  );
};
```

##### 4. 事件浏览器组件

```typescript
// 事件浏览器状态
type EventBrowserState = {
  contractAddress: string;
  chainId: number;
  abiInfo?: {
    abi: any[];
    source: 'sourcify' | 'standard' | 'user';
    verified: boolean;
  };
  availableEvents: string[];
  selectedEvents: string[];
  filters: EventFilter;
  events: ParsedEvent[];
  loading: boolean;
  error?: string;
};

// 事件过滤器UI组件
const EventFilterPanel = ({ 
  filters, 
  onFiltersChange, 
  availableEvents 
}: EventFilterPanelProps) => {
  return (
    <div className="event-filter-panel">
      {/* 事件类型选择 */}
      <FilterSection title="事件类型">
        <EventTypeSelector 
          events={availableEvents}
          selected={filters.eventNames || []}
          onChange={(events) => onFiltersChange({ ...filters, eventNames: events })}
        />
      </FilterSection>

      {/* 时间范围 */}
      <FilterSection title="时间范围">
        <TimeRangePicker 
          range={filters.timeRange}
          onChange={(range) => onFiltersChange({ ...filters, timeRange: range })}
        />
      </FilterSection>

      {/* 区块范围 */}
      <FilterSection title="区块范围">
        <BlockRangePicker 
          fromBlock={filters.fromBlock}
          toBlock={filters.toBlock}
          onChange={(from, to) => onFiltersChange({ 
            ...filters, 
            fromBlock: from, 
            toBlock: to 
          })}
        />
      </FilterSection>

      {/* 参数过滤器 */}
      <FilterSection title="参数过滤">
        <ParameterFilters 
          filters={filters.paramFilters || {}}
          eventAbi={getSelectedEventAbi(filters.eventNames)}
          onChange={(paramFilters) => onFiltersChange({ ...filters, paramFilters })}
        />
      </FilterSection>
    </div>
  );
};
```

#### 性能优化策略

##### 1. 分批查询优化

```typescript
// 大范围事件查询优化
class OptimizedEventQuery {
  async queryLargeRange(filter: EventFilter): Promise<ParsedEvent[]> {
    const maxBlocksPerBatch = 10000; // 每批最大区块数
    const fromBlock = filter.fromBlock || 0;
    const toBlock = filter.toBlock || await this.rpcClient.getBlockNumber();
    
    const totalBlocks = toBlock - fromBlock;
    if (totalBlocks <= maxBlocksPerBatch) {
      // 直接查询
      return await this.queryEvents(filter);
    }

    // 分批查询
    const results: ParsedEvent[] = [];
    const batches = Math.ceil(totalBlocks / maxBlocksPerBatch);
    
    for (let i = 0; i < batches; i++) {
      const batchFromBlock = fromBlock + (i * maxBlocksPerBatch);
      const batchToBlock = Math.min(batchFromBlock + maxBlocksPerBatch - 1, toBlock);
      
      const batchFilter: EventFilter = {
        ...filter,
        fromBlock: batchFromBlock,
        toBlock: batchToBlock
      };

      try {
        const batchResults = await this.queryEvents(batchFilter);
        results.push(...batchResults);
        
        // 避免RPC限制，添加延迟
        if (i < batches - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.warn(`Batch ${i} failed:`, error);
        // 继续下一批，不中断整个查询
      }
    }

    return results;
  }
}
```

##### 2. 事件缓存策略

```typescript
// 事件缓存管理
class EventCacheManager {
  private eventCache = new Map<string, {
    events: ParsedEvent[];
    blockRange: { from: number; to: number };
    timestamp: number;
    chainId: number;
  }>();

  getCacheKey(contractAddress: string, eventName: string, chainId: number): string {
    return `${chainId}:${contractAddress}:${eventName}`;
  }

  async getCachedEvents(
    contractAddress: string,
    eventName: string,
    chainId: number,
    blockRange: { from: number; to: number }
  ): Promise<ParsedEvent[] | null> {
    const key = this.getCacheKey(contractAddress, eventName, chainId);
    const cached = this.eventCache.get(key);

    if (!cached) return null;

    // 检查区块范围是否覆盖
    if (cached.blockRange.from <= blockRange.from && 
        cached.blockRange.to >= blockRange.to) {
      
      // 过滤出指定范围的事件
      return cached.events.filter(event => 
        event.blockNumber >= blockRange.from && 
        event.blockNumber <= blockRange.to
      );
    }

    return null;
  }

  cacheEvents(
    contractAddress: string,
    eventName: string,
    chainId: number,
    events: ParsedEvent[],
    blockRange: { from: number; to: number }
  ): void {
    const key = this.getCacheKey(contractAddress, eventName, chainId);
    
    this.eventCache.set(key, {
      events,
      blockRange,
      timestamp: Date.now(),
      chainId
    });

    // 定期清理过期缓存
    this.scheduleCleanup();
  }
}
```

#### 简化策略的优势

##### ✅ 实用性强
- **Sourcify**: 免费、可靠的去中心化合约验证服务
- **用户上传**: 灵活处理任何合约，支持本地存储
- **标准库**: 快速处理常见合约（ERC20/721/Uniswap等）

##### ✅ 用户体验好
- **零配置**: 无需API Key，降低使用门槛
- **渐进增强**: 找不到ABI时提供明确的解决方案
- **数据持久**: 用户上传的ABI本地保存，支持跨会话使用

##### ✅ 维护成本低
- **代码简单**: 易于理解和维护，避免复杂的字节码分析
- **依赖少**: 只依赖Sourcify一个外部服务
- **扩展性**: 可以随时添加更多标准合约到本地库

这种简化的合约事件索引策略在保持系统轻量级特性的同时，为智能合约交互提供了实用而强大的分析能力。

### API请求流程

```mermaid
sequenceDiagram
    participant C as Client
    participant API as API Gateway
    participant V as Validator
    participant CH as Cache
    participant S as Business Service
    participant DB as DuckDB
    participant RPC as Ethereum RPC

    C->>API: HTTP Request
    API->>V: 参数验证
    
    alt 验证失败
        V-->>API: 返回错误
        API-->>C: 400 Bad Request + 错误详情
    else 验证成功
        V-->>API: 验证通过
        API->>CH: 检查缓存
        
        alt 缓存命中
            CH-->>API: 返回缓存数据
            Note over API: 设置响应头:<br/>X-Cache-Status: hit<br/>X-Data-Source: cache
            API-->>C: 200 OK + 数据 + 头信息
        else 缓存未命中
            API->>S: 调用业务服务
            S->>DB: 查询本地数据库
            
            alt 本地数据存在
                DB-->>S: 返回数据
                S->>CH: 更新缓存
                S-->>API: 返回数据
                Note over API: 设置响应头:<br/>X-Cache-Status: miss<br/>X-Data-Source: database
                API-->>C: 200 OK + 数据 + 头信息
            else 本地数据不存在
                S->>RPC: 获取实时数据
                RPC-->>S: 返回区块链数据
                S->>DB: 异步存储数据
                S->>CH: 更新缓存
                S-->>API: 返回数据
                Note over API: 设置响应头:<br/>X-Cache-Status: miss<br/>X-Data-Source: rpc
                API-->>C: 200 OK + 数据 + 头信息
            end
        end
    end
```

## 数据库设计

### 数据模型

### 多链数据库设计

#### 数据库分离策略
- **每个链使用独立的数据库文件**：`eth_data.db`, `polygon_data.db`, `bsc_data.db` 等
- **共享的配置数据库**：`config.db` 存储链配置、用户偏好等
- **数据隔离**：避免不同链的数据混合，提高查询性能

#### 链配置表（存储在 config.db）
```sql
CREATE TABLE chains (
    chain_id INTEGER PRIMARY KEY,                    -- 链ID
    name VARCHAR(50) NOT NULL,                      -- 链名称
    symbol VARCHAR(10) NOT NULL,                    -- 代币符号
    rpc_url VARCHAR(200) NOT NULL,                  -- RPC地址
    explorer_url VARCHAR(200),                      -- 浏览器地址
    block_time INTEGER DEFAULT 12,                  -- 平均出块时间(秒)
    database_file VARCHAR(50) NOT NULL,             -- 数据库文件名
    is_enabled BOOLEAN DEFAULT true,                -- 是否启用
    supports_eip1559 BOOLEAN DEFAULT false,         -- 支持EIP-1559
    supports_trace BOOLEAN DEFAULT false,           -- 支持trace调用
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入预定义的链配置
INSERT INTO chains (chain_id, name, symbol, rpc_url, database_file, supports_eip1559) VALUES
(1, 'Ethereum', 'ETH', 'https://eth-mainnet.g.alchemy.com/v2/{API_KEY}', 'eth_data.db', true),
(137, 'Polygon', 'MATIC', 'https://polygon-mainnet.g.alchemy.com/v2/{API_KEY}', 'polygon_data.db', true),
(56, 'BSC', 'BNB', 'https://bsc-dataseed.binance.org/', 'bsc_data.db', false),
(42161, 'Arbitrum', 'ETH', 'https://arb-mainnet.g.alchemy.com/v2/{API_KEY}', 'arbitrum_data.db', true),
(8453, 'Base', 'ETH', 'https://base-mainnet.g.alchemy.com/v2/{API_KEY}', 'base_data.db', true);
```

#### 索引状态表（每个链数据库）
```sql
CREATE TABLE index_status (
    type VARCHAR(20) NOT NULL,           -- 'block', 'address', 'token'
    identifier VARCHAR(66) NOT NULL,    -- 区块号、地址、代币合约地址
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (type, identifier)
);
```

#### 区块表（每个链数据库）
```sql
CREATE TABLE blocks (
    number BIGINT PRIMARY KEY,                    -- 区块号
    hash VARCHAR(66) UNIQUE NOT NULL,             -- 区块哈希
    parent_hash VARCHAR(66),                      -- 父区块哈希
    timestamp TIMESTAMP,                          -- 时间戳
    miner VARCHAR(42),                           -- 矿工地址（验证者地址）
    gas_limit BIGINT,                            -- Gas限制
    gas_used BIGINT,                             -- 已使用Gas
    base_fee_per_gas BIGINT,                     -- EIP-1559基础费用（如果支持）
    transaction_count INTEGER,                    -- 交易数量
    size_bytes INTEGER,                          -- 区块大小
    difficulty VARCHAR(32),                      -- 难度值（PoW链）
    total_difficulty VARCHAR(32),                -- 总难度（PoW链）
    extra_data TEXT,                             -- 额外数据
    logs_bloom TEXT,                             -- 日志布隆过滤器
    state_root VARCHAR(66),                      -- 状态根
    transactions_root VARCHAR(66),               -- 交易根
    receipts_root VARCHAR(66),                   -- 收据根
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- 索引时间
);

-- 创建索引
CREATE INDEX idx_blocks_timestamp ON blocks(timestamp DESC);
CREATE INDEX idx_blocks_miner ON blocks(miner);
```

#### 交易表（每个链数据库）
```sql
CREATE TABLE transactions (
    hash VARCHAR(66) PRIMARY KEY,                -- 交易哈希
    block_number BIGINT,                         -- 区块号
    transaction_index INTEGER,                   -- 交易索引
    from_address VARCHAR(42),                    -- 发送方地址
    to_address VARCHAR(42),                      -- 接收方地址（创建合约时为NULL）
    value DECIMAL(38,0),                         -- 转账金额
    gas_limit BIGINT,                            -- Gas限制
    gas_price BIGINT,                            -- Gas价格（Legacy交易）
    max_fee_per_gas BIGINT,                      -- 最大费用（EIP-1559）
    max_priority_fee_per_gas BIGINT,             -- 最大优先费用（EIP-1559）
    gas_used BIGINT,                             -- 实际使用Gas
    effective_gas_price BIGINT,                  -- 实际Gas价格
    status INTEGER,                              -- 交易状态（0=失败，1=成功）
    type INTEGER DEFAULT 0,                      -- 交易类型（0=Legacy，1=AccessList，2=EIP1559）
    nonce BIGINT,                                -- 账户nonce
    input_data TEXT,                             -- 输入数据
    logs_count INTEGER DEFAULT 0,                -- 日志数量
    contract_address VARCHAR(42),                -- 创建的合约地址（如果是合约创建）
    cumulative_gas_used BIGINT,                  -- 累计Gas使用量
    timestamp TIMESTAMP,                         -- 时间戳
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- 索引时间
);

-- 创建索引
CREATE INDEX idx_transactions_block ON transactions(block_number);
CREATE INDEX idx_transactions_from ON transactions(from_address);
CREATE INDEX idx_transactions_to ON transactions(to_address);
CREATE INDEX idx_transactions_timestamp ON transactions(timestamp DESC);
CREATE INDEX idx_transactions_type ON transactions(type);
```

#### 地址索引表（记录用户查询过的地址）
```sql
CREATE TABLE indexed_addresses (
    address VARCHAR(42) PRIMARY KEY,             -- 地址
    label VARCHAR(100),                          -- 用户自定义标签
    first_seen_block BIGINT,                     -- 首次出现区块
    last_seen_block BIGINT,                      -- 最后出现区块
    transaction_count INTEGER DEFAULT 0,         -- 交易次数
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,     -- 首次索引时间
    last_queried TIMESTAMP DEFAULT CURRENT_TIMESTAMP    -- 最后查询时间
);
```

#### 搜索历史表（提高搜索体验）
```sql
CREATE TABLE search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query VARCHAR(100) NOT NULL,                -- 搜索关键词
    result_type VARCHAR(20),                     -- 'block', 'transaction', 'address'
    result_id VARCHAR(66),                       -- 结果ID
    searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 用户偏好表
```sql
CREATE TABLE user_preferences (
    key VARCHAR(50) PRIMARY KEY,                 -- 配置键
    value TEXT,                                  -- 配置值
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 访问历史表（用于优化和清理）
```sql
CREATE TABLE access_history (
    type VARCHAR(20) NOT NULL,                   -- 'block', 'address', 'transaction'
    identifier VARCHAR(66) NOT NULL,            -- 区块号、地址、交易哈希
    first_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    access_count INTEGER DEFAULT 1,
    PRIMARY KEY (type, identifier)
);
```

### 轻量级索引策略

```sql
-- 基础查询索引
CREATE INDEX idx_blocks_timestamp ON blocks(timestamp DESC);
CREATE INDEX idx_transactions_block_number ON transactions(block_number);
CREATE INDEX idx_transactions_addresses ON transactions(from_address, to_address);

-- 按需索引相关
CREATE INDEX idx_indexed_addresses_queried ON indexed_addresses(last_queried DESC);
CREATE INDEX idx_search_history_query ON search_history(query);
CREATE INDEX idx_index_status_type ON index_status(type, last_updated);
CREATE INDEX idx_access_history_type ON access_history(type, last_accessed DESC);
CREATE INDEX idx_access_history_count ON access_history(access_count DESC);

-- 轻量级复合索引（仅针对常用查询）
CREATE INDEX idx_transactions_address_block ON transactions(from_address, block_number);
CREATE INDEX idx_transactions_to_block ON transactions(to_address, block_number);
```

### 数据清理策略

```sql
-- 定期清理旧的搜索历史（保留最近30天）
DELETE FROM search_history 
WHERE searched_at < datetime('now', '-30 days');

-- 清理长期未查询的地址索引（可选，保留用户主动查询的数据）
-- DELETE FROM indexed_addresses 
-- WHERE last_queried < datetime('now', '-90 days');

-- 清理过期的索引状态
DELETE FROM index_status 
WHERE last_updated < datetime('now', '-7 days') 
AND type = 'temp';
```

### 数据分区策略

```sql
-- 按月分区交易表（DuckDB暂不支持，考虑应用层分区）
-- 大表查询优化策略
CREATE VIEW recent_transactions AS 
SELECT * FROM transactions 
WHERE timestamp > (CURRENT_TIMESTAMP - INTERVAL '30 days');

CREATE VIEW recent_token_transfers AS 
SELECT * FROM token_transfers 
WHERE timestamp > (CURRENT_TIMESTAMP - INTERVAL '30 days');
```

### 数据获取策略

#### 1. 实时数据（浏览器直接RPC）
- **最新区块信息**：直接从 RPC 获取
- **实时余额查询**：直接调用 RPC
- **交易状态**：直接查询 RPC
- **Gas 价格**：实时从 RPC 获取

#### 2. 历史数据（本地按需索引）
- **用户搜索的区块**：首次搜索时索引并存储
- **用户查询的地址**：按需索引交易历史
- **统计数据**：基于已索引数据计算
- **搜索建议**：基于历史查询记录

#### 3. 轻量级缓存
- **内存缓存**：简单的 Map 结构，存储热点数据
- **浏览器缓存**：静态资源和短期 API 响应
- **本地存储**：用户偏好和搜索历史

### 按需索引实现

```typescript
// 按需索引服务
class OnDemandIndexService {
  private indexedBlocks = new Set<number>();
  private indexedAddresses = new Set<string>();
  
  // 按需索引区块
  async indexBlockIfNeeded(blockNumber: number): Promise<void> {
    if (this.indexedBlocks.has(blockNumber)) {
      return; // 已索引，跳过
    }
    
    // 从 RPC 获取区块数据
    const block = await ethereumClient.getBlock(BigInt(blockNumber));
    
    // 存储到本地数据库
    await this.storeBlock(block);
    
    // 标记为已索引
    this.indexedBlocks.add(blockNumber);
  }
  
  // 按需索引地址交易
  async indexAddressTransactions(address: string, fromBlock?: number): Promise<void> {
    if (this.indexedAddresses.has(address)) {
      return; // 已索引
    }
    
    // 使用 RPC 查询地址相关交易（或第三方API）
    const transactions = await this.getAddressTransactions(address, fromBlock);
    
    // 存储相关区块和交易
    for (const tx of transactions) {
      await this.indexBlockIfNeeded(tx.blockNumber);
    }
    
    this.indexedAddresses.add(address);
  }
  
  private memoryCache = new Map<string, { data: any; expires: number }>();
  
  // 简单内存缓存
  cache(key: string, data: any, ttlSeconds = 300): void {
    this.memoryCache.set(key, {
      data,
      expires: Date.now() + ttlSeconds * 1000
    });
  }
  
  getCache(key: string): any | null {
    const cached = this.memoryCache.get(key);
    if (!cached || cached.expires < Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }
    return cached.data;
  }
}
```

## 性能优化

### 数据库优化

#### 查询优化
```sql
-- 优化最新区块查询
SELECT * FROM blocks 
ORDER BY number DESC 
LIMIT 20;

-- 优化地址交易历史查询
SELECT t.*, b.timestamp 
FROM transactions t
JOIN blocks b ON t.block_number = b.number
WHERE t.from_address = ? OR t.to_address = ?
ORDER BY b.timestamp DESC
LIMIT 20 OFFSET ?;

-- 优化统计查询
SELECT 
    DATE_TRUNC('day', timestamp) as date,
    COUNT(*) as transaction_count,
    AVG(gas_price) as avg_gas_price
FROM transactions 
WHERE timestamp >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', timestamp)
ORDER BY date;
```

#### 存储优化
```sql
-- 数据压缩设置
PRAGMA memory_limit='2GB';
PRAGMA temp_directory='/tmp/duckdb_temp';

-- 预聚合表创建
CREATE TABLE daily_stats AS
SELECT 
    DATE_TRUNC('day', timestamp) as date,
    COUNT(*) as tx_count,
    AVG(gas_price) as avg_gas_price,
    SUM(gas_used) as total_gas_used,
    COUNT(DISTINCT from_address) as active_addresses
FROM transactions
GROUP BY DATE_TRUNC('day', timestamp);
```

### API优化

#### 响应优化
```typescript
// 分页优化
type PaginationParams = {
  page: number;
  limit: number;
  cursor?: string; // 游标分页，适用于大数据集
};

// 字段选择
type FieldSelection = {
  select?: string[]; // 只返回指定字段
  exclude?: string[]; // 排除指定字段
};

// 批量查询
type BatchQuery = {
  queries: Array<{
    type: 'block' | 'transaction' | 'address';
    params: any;
  }>;
};
```

#### 连接池优化
```typescript
// 数据库连接池配置
const dbConfig = {
  maxConnections: 10,
  idleTimeout: 30000,
  acquireTimeout: 60000,
  retryAttempts: 3,
};

// 查询超时设置
const queryTimeout = {
  simple: 5000,    // 简单查询5秒超时
  complex: 30000,  // 复杂查询30秒超时
  batch: 60000,    // 批量查询60秒超时
};
```

## 监控告警

### 系统监控指标

#### 性能指标
- **响应时间**：API接口平均响应时间
- **吞吐量**：每秒处理请求数量
- **错误率**：4xx/5xx错误请求比例
- **数据库性能**：查询执行时间、连接数

#### 业务指标
- **同步延迟**：与最新区块的差距
- **数据完整性**：丢失区块或交易检查
- **缓存命中率**：各级缓存命中情况
- **用户活跃度**：日活、页面访问量

### 告警策略

```typescript
// 告警规则配置
const alertRules = {
  // 系统告警
  system: {
    highResponseTime: { threshold: 2000, duration: '5m' },
    highErrorRate: { threshold: 0.05, duration: '3m' },
    lowMemory: { threshold: 0.1, duration: '1m' },
    highCpuUsage: { threshold: 0.8, duration: '5m' },
  },
  
  // 业务告警
  business: {
    syncDelay: { threshold: 10, duration: '2m' },      // 同步延迟超过10个区块
    lowCacheHitRate: { threshold: 0.7, duration: '10m' }, // 缓存命中率低于70%
    dataInconsistency: { threshold: 1, duration: '0m' },   // 数据不一致立即告警
  }
};
```

## 安全设计

### 输入验证

```typescript
// 地址验证
const isValidAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

// 交易哈希验证
const isValidTxHash = (hash: string): boolean => {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
};

// 区块号验证
const isValidBlockNumber = (blockNumber: string): boolean => {
  const num = parseInt(blockNumber, 10);
  return !isNaN(num) && num >= 0 && num <= Number.MAX_SAFE_INTEGER;
};
```

### 访问控制

```typescript
// 速率限制配置
const rateLimitConfig = {
  global: { max: 1000, window: '15m' },      // 全局限制
  ip: { max: 100, window: '1m' },            // IP限制
  endpoint: {
    search: { max: 30, window: '1m' },       // 搜索接口限制
    stats: { max: 10, window: '1m' },        // 统计接口限制
  }
};

// CORS配置
const corsConfig = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 预检请求缓存24小时
};
```

### 数据安全

```typescript
// SQL注入防护
const sanitizeQuery = (query: string): string => {
  // 使用参数化查询，不直接拼接SQL
  return query.replace(/[^\w\s]/gi, '');
};

// XSS防护
const sanitizeOutput = (data: any): any => {
  if (typeof data === 'string') {
    return data.replace(/[<>\"']/g, '');
  }
  return data;
};
```

## 部署架构

### 开发环境

```mermaid
graph TD
    A[Frontend<br/>localhost:3000<br/>Vite Dev Server] --> B[Backend<br/>localhost:3001<br/>Hono API]
    B --> C[DuckDB<br/>local file<br/>data/blocks.db]
    
    A -.->|Direct RPC| D[Ethereum RPC<br/>Infura/Alchemy]
    
    style A fill:#e3f2fd
    style B fill:#f3e5f5
    style C fill:#e8f5e8
    style D fill:#fff8e1
```

### 生产环境

```mermaid
graph TD
    A[CDN/Edge<br/>Cloudflare Pages<br/>Global Distribution] --> B[Load Balancer<br/>Nginx<br/>SSL Termination]
    B --> C[Backend Cluster<br/>PM2/Docker<br/>Multiple Instances]
    C --> D[DuckDB<br/>Persistent Storage<br/>+ Backup Strategy]
    
    A -.->|Direct RPC| E[Ethereum RPC<br/>Load Balanced<br/>Multiple Providers]
    C --> E
    
    style A fill:#e3f2fd
    style B fill:#f3e5f5
    style C fill:#fff8e1
    style D fill:#e8f5e8
    style E fill:#fce4ec
```

### 容器化部署

```dockerfile
# backend/Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY data ./data

EXPOSE 3001
CMD ["node", "dist/app.js"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - DATABASE_PATH=/app/data/blockchain.duckdb
    restart: unless-stopped
    
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - backend
    restart: unless-stopped
```

## 扩展规划

### 水平扩展

#### 读写分离

```mermaid
graph TD
    A[Write Node<br/>Master Instance<br/>Write Operations] --> B[Primary DB<br/>DuckDB Master<br/>Real-time Writes]
    
    A -.->|Replication| C[Read Node 1<br/>Replica Instance<br/>Query Load Balancing]
    A -.->|Replication| D[Read Node 2<br/>Replica Instance<br/>Backup Queries]
    
    B -->|Data Sync| E[Read Replica 1<br/>DuckDB Copy<br/>Query Optimization]
    B -->|Data Sync| F[Read Replica 2<br/>DuckDB Copy<br/>Failover Ready]
    
    C --> E
    D --> F
    
    style A fill:#ffcdd2
    style B fill:#ffcdd2
    style C fill:#c8e6c9
    style D fill:#c8e6c9
    style E fill:#c8e6c9
    style F fill:#c8e6c9
```

#### 分片策略
- **按时间分片**：不同时间段的数据存储在不同节点
- **按数据类型分片**：区块、交易、地址数据分别存储
- **按负载分片**：根据访问频率分配存储

### 功能扩展

#### 多链支持
- **链抽象层**：统一的区块链接口
- **配置化**：通过配置支持新链
- **数据隔离**：不同链的数据独立存储

#### 高级分析
- **DeFi协议支持**：DEX、借贷、流动性挖矿
- **NFT追踪**：NFT交易、持有、价格趋势
- **MEV分析**：MEV机器人、套利交易识别
- **智能合约分析**：合约调用关系、Gas优化建议

---

本架构设计文档将随着项目发展持续更新和完善。
