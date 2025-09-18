# 配置文件示例

## 多链配置

### 环境变量配置 (.env)
```bash
# 端口配置
CLIENT_PORT=3000
SERVER_PORT=3001

# 数据库配置
DATA_DIR=./data
CONFIG_DB=config.db

# 支持的链配置 (JSON格式)
CHAINS_CONFIG={
  "1": {
    "name": "Ethereum",
    "symbol": "ETH", 
    "rpcUrl": "https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}",
    "explorerUrl": "https://etherscan.io",
    "blockTime": 12,
    "database": "eth_data.db",
    "features": {
      "supportsEIP1559": true,
      "supportsTrace": true
    }
  },
  "137": {
    "name": "Polygon",
    "symbol": "MATIC",
    "rpcUrl": "https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}",
    "explorerUrl": "https://polygonscan.com", 
    "blockTime": 2,
    "database": "polygon_data.db",
    "features": {
      "supportsEIP1559": true,
      "supportsTrace": false
    }
  },
  "56": {
    "name": "BSC",
    "symbol": "BNB",
    "rpcUrl": "https://bsc-dataseed.binance.org/",
    "explorerUrl": "https://bscscan.com",
    "blockTime": 3,
    "database": "bsc_data.db", 
    "features": {
      "supportsEIP1559": false,
      "supportsTrace": false
    }
  }
}

# API Keys
ALCHEMY_API_KEY=your_alchemy_api_key
INFURA_API_KEY=your_infura_api_key

# 缓存配置
MEMORY_CACHE_SIZE=100MB
CACHE_TTL_BLOCKS=300    # 5分钟
CACHE_TTL_TRANSACTIONS=600  # 10分钟

# 日志配置
LOG_LEVEL=info
LOG_FILE=./logs/app.log

# 功能开关
ENABLE_REAL_TIME_SYNC=true
ENABLE_METRICS_COLLECTION=true
DEFAULT_CHAIN_ID=1
```

## Monorepo 配置

### package.json (根目录)
```json
{
  "name": "block-explorer",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite",
    "dev:server": "tsx watch server.ts",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build && npm run setup:spa",
    "build:server": "tsc",
    "setup:spa": "echo '/* /index.html 200' > dist/client/_redirects",
    "start": "node dist/server.js",
    "preview": "vite preview",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "lint": "eslint . --ext ts,tsx",
    "format": "prettier --write .",
    "clean": "rm -rf dist",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio",
    "migrate": "tsx database/migrate.ts"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.5.0",
    "echarts": "^5.5.1",
    "echarts-for-react": "^3.0.2",
    "@linaria/core": "^6.2.0",
    "@linaria/react": "^6.2.0",
    "hono": "^5.0.1",
    "duckdb": "^1.1.3",
    "drizzle-orm": "^0.36.4",
    "viem": "^2.21.45",
    "pino": "^9.5.0",
    "pino-pretty": "^12.0.0",
    "node-cron": "^3.0.3",
    "@hono/node-server": "^1.13.1"
  },
  "devDependencies": {
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@types/node": "^22.10.2",
    "@types/node-cron": "^3.0.11",
    "@typescript-eslint/eslint-plugin": "^8.18.1",
    "@typescript-eslint/parser": "^8.18.1",
    "@vitejs/plugin-react": "^4.3.4",
    "@wyw-in-js/vite": "^0.5.4",
    "@wyw-in-js/babel-preset": "^0.5.4",
    "@babel/preset-react": "^7.25.9",
    "@babel/preset-typescript": "^7.25.9",
    "@babel/plugin-transform-react-jsx": "^7.25.9",
    "@vitest/coverage-v8": "^2.1.8",
    "drizzle-kit": "^0.28.1",
    "jsdom": "^25.0.1",
    "concurrently": "^9.1.0",
    "eslint": "^9.17.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-react-refresh": "^0.4.16",
    "prettier": "^3.4.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vite": "^6.0.7",
    "vitest": "^2.1.8"
  }
}
```

### vite.client.config.ts (前端配置)
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createVitePlugin as linaria } from '@linaria/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react({
      // 启用React 19的新特性
      babel: {
        plugins: [
          ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
        ]
      }
    }),
    linaria({
      sourceMap: process.env.NODE_ENV !== 'production',
      babelOptions: {
        presets: ['@babel/preset-typescript', '@babel/preset-react']
      }
    }),
  ],
  root: './src/client',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/shared': path.resolve(__dirname, './src/shared'),
      '@/client': path.resolve(__dirname, './src/client'),
      '@/components': path.resolve(__dirname, './src/client/components'),
      '@/pages': path.resolve(__dirname, './src/client/pages'),
      '@/hooks': path.resolve(__dirname, './src/client/hooks'),
      '@/styles': path.resolve(__dirname, './src/client/styles'),
      '@/api': path.resolve(__dirname, './src/client/api'),
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
    rollupOptions: {
      input: path.resolve(__dirname, 'src/client/index.html'),
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          charts: ['echarts', 'echarts-for-react'],
        },
      },
    },
  },
  server: {
    port: parseInt(process.env.CLIENT_PORT || '3000'),
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.SERVER_PORT || '3001'}`,
        changeOrigin: true,
      },
    },
  },
  publicDir: path.resolve(__dirname, 'public'),
});
```

### vitest.config.ts
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
        ]
      }
    })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'dist/'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/shared': path.resolve(__dirname, './src/shared'),
      '@/client': path.resolve(__dirname, './src/client'),
      '@/server': path.resolve(__dirname, './src/server'),
    },
  },
});
```

### tsconfig.json (基础配置)
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/shared/*": ["./src/shared/*"],
      "@/client/*": ["./src/client/*"],
      "@/server/*": ["./src/server/*"]
    }
  }
}
```

### tsconfig.client.json (前端专用)
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"],
      "@/shared/*": ["./src/shared/*"],
      "@/client/*": ["./src/client/*"],
      "@/components/*": ["./src/client/components/*"],
      "@/pages/*": ["./src/client/pages/*"],
      "@/hooks/*": ["./src/client/hooks/*"],
      "@/styles/*": ["./src/client/styles/*"],
      "@/api/*": ["./src/client/api/*"]
    }
  },
  "include": [
    "src/shared/**/*",
    "src/client/**/*"
  ],
  "exclude": ["node_modules", "dist"]
}
```

### tsconfig.server.json (后端专用)
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist/server",
    "noEmit": false,
    "paths": {
      "@/*": ["./src/*"],
      "@/shared/*": ["./src/shared/*"],
      "@/server/*": ["./src/server/*"]
    }
  },
  "include": [
    "src/shared/**/*",
    "src/server/**/*"
  ],
  "exclude": ["node_modules", "dist", "src/client"]
}
```

### drizzle.config.ts
```typescript
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/server/database/schema.ts',
  out: './src/server/database/migrations',
  driver: 'pg', // 使用 PostgreSQL 驱动（通过适配器）
  dbCredentials: {
    connectionString: 'duckdb://data/blockchain.db',
  },
  verbose: true,
  strict: true,
} satisfies Config;
```

### .env 示例
```bash
# 应用配置
NODE_ENV=development
CLIENT_PORT=3000
SERVER_PORT=3001
LOG_LEVEL=info

# 数据库配置
DATABASE_PATH=./data/blockchain.duckdb
DATABASE_MEMORY_LIMIT=2GB
DATABASE_THREADS=4

# 以太坊配置
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
ETHEREUM_CHAIN_ID=1
SYNC_BATCH_SIZE=100
SYNC_INTERVAL=12000

# 前端环境变量 (Vite)
VITE_API_URL=http://localhost:3001
VITE_APP_NAME=Block Explorer
VITE_APP_VERSION=1.0.0
VITE_ENABLE_CHARTS=true
VITE_ENABLE_SEARCH=true

# 缓存配置
CACHE_TTL=300
MEMORY_CACHE_SIZE=100MB

# 安全配置
CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100
```

## 共享代码示例

### 共享类型定义 (src/shared/types/index.ts)
```typescript
// API响应类型（简化版）
export type ApiResponse<T> = T;

// 列表响应类型
export type ListResponse<T> = {
  data: T[];
  pagination: PaginationInfo;
};

// 错误响应类型
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

// 区块链数据类型
export type Block = {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: string;
  miner: string;
  gasLimit: string;
  gasUsed: string;
  baseFeePerGas?: string;
  transactionCount: number;
  size: number;
  totalDifficulty?: string;
  uncleCount?: number;
  reward?: string;
  transactions?: string[];
};

export type Transaction = {
  hash: string;
  blockNumber: number;
  transactionIndex: number;
  from: string;
  to: string | null;
  value: string;
  gasLimit: string;
  gasPrice: string;
  gasUsed?: string;
  status?: number;
  inputData: string;
  nonce: number;
  transactionType?: number;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  timestamp: string;
};

export type AddressInfo = {
  address: string;
  balance: string;
  transactionCount: number;
  firstSeenBlock: number;
  lastSeenBlock: number;
  isContract: boolean;
  contractCreator?: string;
  creationTransaction?: string;
  totalReceived: string;
  totalSent: string;
  updatedAt: string;
};

export type SearchResult = {
  type: 'block' | 'transaction' | 'address';
  data: Block | Transaction | AddressInfo;
  match: {
    field: string;
    value: string;
    similarity?: number;
  };
};

export type NetworkStats = {
  latestBlock: number;
  avgBlockTime: number;
  avgGasPrice: string;
  totalTransactions: number;
  activeAddresses24h: number;
  totalSupply: string;
  marketCap?: string;
  price?: {
    usd: number;
    change24h: number;
  };
};
```

### 共享工具函数 (src/shared/utils/format.ts)
```typescript
// 格式化以太坊地址
export function formatAddress(address: string, short = true): string {
  if (!address) return '';
  if (!short) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// 格式化以太坊金额
export function formatEther(wei: string | bigint): string {
  const ether = BigInt(wei) / BigInt(10 ** 18);
  return ether.toString();
}

// 格式化Gas价格
export function formatGasPrice(gasPrice: string | bigint): string {
  const gwei = BigInt(gasPrice) / BigInt(10 ** 9);
  return `${gwei.toString()} Gwei`;
}

// 格式化时间戳
export function formatTimestamp(timestamp: string | number): string {
  const date = new Date(typeof timestamp === 'string' ? parseInt(timestamp) * 1000 : timestamp);
  return date.toLocaleString();
}

// 格式化区块大小
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
```

### 共享常量 (src/shared/constants/index.ts)
```typescript
// API相关常量
export const API_ENDPOINTS = {
  BLOCKS: '/api/blocks',
  TRANSACTIONS: '/api/transactions', 
  ADDRESSES: '/api/addresses',
  SEARCH: '/api/search',
  STATS: '/api/stats',
  HEALTH: '/api/health',
} as const;

// 区块链常量
export const ETHEREUM = {
  CHAIN_ID: 1,
  DECIMALS: 18,
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  BLOCK_TIME: 12, // 平均出块时间(秒)
} as const;

// 分页常量
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

// 缓存TTL
export const CACHE_TTL = {
  LATEST_BLOCK: 10, // 10秒
  BLOCK_DETAILS: 3600, // 1小时
  TRANSACTION_DETAILS: 1800, // 30分钟
  ADDRESS_INFO: 300, // 5分钟
  STATS: 300, // 5分钟
} as const;
```

## Hono 应用示例

### src/app.ts
```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { pino } from 'pino';

import { blocksRouter } from './routes/blocks.js';
import { transactionsRouter } from './routes/transactions.js';
import { addressesRouter } from './routes/addresses.js';
import { searchRouter } from './routes/search.js';
import { statsRouter } from './routes/stats.js';
import { healthRouter } from './routes/health.js';

import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/error.js';

const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

const app = new Hono();

// 中间件
app.use('*', logger());
app.use('*', prettyJSON());
app.use(
  '*',
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['*'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// 速率限制
app.use('/api/*', rateLimitMiddleware);

// 路由
app.route('/api/blocks', blocksRouter);
app.route('/api/transactions', transactionsRouter);
app.route('/api/addresses', addressesRouter);
app.route('/api/search', searchRouter);
app.route('/api/stats', statsRouter);
app.route('/api/health', healthRouter);

// 根路径
app.get('/', (c) => {
  return c.json({
    name: 'Block Explorer API',
    version: '1.0.0',
    status: 'ok',
  });
});

// 错误处理
app.onError(errorHandler);

const port = parseInt(process.env.PORT || '3001');

log.info(`Server starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
```

### src/routes/blocks.ts
```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { BlockService } from '../services/BlockService.js';

const blocks = new Hono();
const blockService = new BlockService();

// 获取最新区块
blocks.get('/latest', async (c) => {
  try {
    const block = await blockService.getLatestBlock();
    return c.json({
      success: true,
      data: block,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch latest block',
        },
      },
      500
    );
  }
});

// 获取指定区块
blocks.get(
  '/:number',
  zValidator(
    'param',
    z.object({
      number: z.string().refine((val) => {
        return val === 'latest' || /^\\d+$/.test(val);
      }, 'Invalid block number'),
    })
  ),
  async (c) => {
    const { number } = c.req.valid('param');
    
    try {
      const block = number === 'latest' 
        ? await blockService.getLatestBlock()
        : await blockService.getBlockByNumber(parseInt(number));
        
      if (!block) {
        return c.json(
          {
            success: false,
            error: {
              code: 'RESOURCE_NOT_FOUND',
              message: 'Block not found',
            },
          },
          404
        );
      }
      
      return c.json({
        success: true,
        data: block,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch block',
          },
        },
        500
      );
    }
  }
);

// 获取区块列表
blocks.get(
  '/',
  zValidator(
    'query',
    z.object({
      page: z.string().optional().default('1'),
      limit: z.string().optional().default('20'),
      sort: z.string().optional().default('number'),
      order: z.enum(['asc', 'desc']).optional().default('desc'),
    })
  ),
  async (c) => {
    const { page, limit, sort, order } = c.req.valid('query');
    
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100); // 最大100
    
    try {
      const result = await blockService.getBlocks({
        page: pageNum,
        limit: limitNum,
        sort,
        order,
      });
      
      return c.json({
        success: true,
        data: result.blocks,
        pagination: result.pagination,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch blocks',
          },
        },
        500
      );
    }
  }
);

export { blocks as blocksRouter };
```

## Viem 客户端配置

### src/utils/ethereum.ts
```typescript
import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { pino } from 'pino';

const log = pino().child({ module: 'ethereum' });

class EthereumClient {
  private client: PublicClient;
  
  constructor() {
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(process.env.ETHEREUM_RPC_URL),
      batch: {
        multicall: true,
      },
      pollingInterval: 12000,
    });
    
    log.info('Ethereum client initialized');
  }
  
  async getLatestBlockNumber(): Promise<bigint> {
    return await this.client.getBlockNumber();
  }
  
  async getBlock(blockNumber: bigint | 'latest') {
    return await this.client.getBlock({
      blockNumber: blockNumber === 'latest' ? undefined : blockNumber,
      includeTransactions: true,
    });
  }
  
  async getTransaction(hash: `0x${string}`) {
    return await this.client.getTransaction({ hash });
  }
  
  async getTransactionReceipt(hash: `0x${string}`) {
    return await this.client.getTransactionReceipt({ hash });
  }
  
  async getBalance(address: `0x${string}`) {
    return await this.client.getBalance({ address });
  }
  
  async getTransactionCount(address: `0x${string}`) {
    return await this.client.getTransactionCount({ address });
  }
}

export const ethereumClient = new EthereumClient();
```

## DuckDB 配置

### src/database/connection.ts
```typescript
import Database from 'duckdb';
import { pino } from 'pino';
import path from 'path';
import fs from 'fs';

const log = pino().child({ module: 'database' });

class DatabaseConnection {
  private db: Database.Database;
  private connection: Database.Connection | null = null;
  
  constructor() {
    const dbPath = process.env.DATABASE_PATH || './data/blockchain.duckdb';
    
    // 确保数据目录存在
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    this.db = new Database.Database(dbPath);
    log.info(\`Database initialized at \${dbPath}\`);
  }
  
  async connect(): Promise<Database.Connection> {
    if (this.connection) {
      return this.connection;
    }
    
    return new Promise((resolve, reject) => {
      this.db.connect((err, connection) => {
        if (err) {
          log.error('Failed to connect to database', err);
          reject(err);
          return;
        }
        
        this.connection = connection;
        
        // 配置数据库
        this.setupDatabase(connection);
        
        log.info('Database connection established');
        resolve(connection);
      });
    });
  }
  
  private setupDatabase(connection: Database.Connection) {
    const memoryLimit = process.env.DATABASE_MEMORY_LIMIT || '2GB';
    const threads = process.env.DATABASE_THREADS || '4';
    
    connection.run(\`PRAGMA memory_limit='\${memoryLimit}'\`);
    connection.run(\`PRAGMA threads=\${threads}\`);
    connection.run(\`PRAGMA enable_progress_bar=true\`);
    
    log.info('Database configuration applied');
  }
  
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const connection = await this.connect();
    
    return new Promise((resolve, reject) => {
      connection.all(sql, params, (err, rows) => {
        if (err) {
          log.error('Query failed', { sql, params, error: err });
          reject(err);
          return;
        }
        
        resolve(rows as T[]);
      });
    });
  }
  
  async run(sql: string, params: any[] = []): Promise<void> {
    const connection = await this.connect();
    
    return new Promise((resolve, reject) => {
      connection.run(sql, params, (err) => {
        if (err) {
          log.error('Command failed', { sql, params, error: err });
          reject(err);
          return;
        }
        
        resolve();
      });
    });
  }
  
  async close(): Promise<void> {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    
    this.db.close();
    log.info('Database connection closed');
  }
}

export const db = new DatabaseConnection();
```

## Linaria 样式配置

### src/styles/theme.ts
```typescript
import { css } from '@linaria/core';

export const theme = {
  colors: {
    primary: '#3b82f6',
    secondary: '#64748b',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#1e293b',
    textSecondary: '#64748b',
    border: '#e2e8f0',
  },
  
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
  },
  
  breakpoints: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
  },
  
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
    },
  },
  
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  },
};

export const globalStyles = css\`
  :global() {
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: \${theme.typography.fontFamily};
      color: \${theme.colors.text};
      background-color: \${theme.colors.background};
      line-height: 1.5;
    }
    
    a {
      color: \${theme.colors.primary};
      text-decoration: none;
      
      &:hover {
        text-decoration: underline;
      }
    }
    
    button {
      font-family: inherit;
      cursor: pointer;
    }
    
    input, textarea {
      font-family: inherit;
    }
  }
\`;
```

## 部署配置

### Cloudflare Pages 配置
```yaml
# wrangler.toml
name = "block-explorer"
compatibility_date = "2023-11-15"

[build]
command = "npm run build"
publish = "dist"

[env.production.vars]
VITE_API_URL = "https://your-api-domain.com"
VITE_APP_NAME = "Block Explorer"

[env.preview.vars]
VITE_API_URL = "https://api-preview.your-domain.com"
```

### Docker 配置
```dockerfile
# frontend/Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

```dockerfile
# backend/Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3001
CMD ["node", "dist/app.js"]
```

这些配置文件展示了如何设置现代化的前后端技术栈，充分利用了 Vite、Hono、Linaria 等工具的优势。
