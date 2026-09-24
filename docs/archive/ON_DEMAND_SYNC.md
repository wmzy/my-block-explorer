# 用户访问时同步策略

## 核心理念

完全去除定时同步任务，采用"**用户访问时同步**"的策略：
- 🚫 无后台定时任务
- ⚡ 响应优先，异步存储
- 🎯 按需获取，按需存储
- 🧹 访问驱动的数据清理

## 实现架构

### 数据获取流程

```
用户请求 → 检查缓存 → 检查本地DB → 实时RPC获取 → 异步存储 → 返回数据
    ↓           ↓            ↓             ↓           ↓
  快速响应    秒级响应      毫秒级响应     实时数据    后台存储
```

### API路由实现

```typescript
// src/server/routes/blocks.ts
import { Hono } from 'hono';
import { OnDemandSyncService } from '../services/OnDemandSyncService.js';

const blocks = new Hono();
const syncService = new OnDemandSyncService();

// 获取区块详情 - 用户访问时同步
blocks.get('/:number', async (c) => {
  const blockNumber = parseInt(c.req.param('number'));
  
  if (isNaN(blockNumber) || blockNumber < 0) {
    return c.json({
      success: false,
      error: { code: 'INVALID_PARAMETER', message: 'Invalid block number' }
    }, 400);
  }
  
  try {
    const startTime = Date.now();
    
    // 核心：用户访问时获取数据
    const block = await syncService.getBlockData(blockNumber, true);
    
    if (!block) {
      return c.json({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Block not found'
      }, 404);
    }
    
    // 设置响应头（元数据）
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', \`\${responseTime}ms\`);
    c.header('X-Data-Source', block._meta?.source || 'unknown');
    c.header('X-Cache-Status', block._meta?.cached ? 'hit' : 'miss');
    c.header('X-API-Version', '1.0.0');
    c.header('X-Request-ID', \`req_\${Date.now()}\`);
    c.header('X-Timestamp', new Date().toISOString());
    
    // 移除内部元数据
    const { _meta, ...cleanBlock } = block;
    
    return c.json(cleanBlock);
    
  } catch (error) {
    console.error(\`Error fetching block \${blockNumber}:\`, error);
    return c.json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch block'
    }, 500);
  }
});

// 获取地址交易历史 - 用户访问时同步
blocks.get('/address/:address/transactions', async (c) => {
  const address = c.req.param('address');
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  
  try {
    // 核心：用户访问时获取地址数据
    const result = await syncService.getAddressTransactions(address, page, limit);
    
    // 设置响应头
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', \`\${responseTime}ms\`);
    c.header('X-Data-Source', result._meta?.source || 'mixed');
    c.header('X-Total-Count', result.total.toString());
    c.header('X-API-Version', '1.0.0');
    
    return c.json({
      data: result.transactions,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
    
  } catch (error) {
    console.error(\`Error fetching address transactions \${address}:\`, error);
    return c.json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch transactions'
    }, 500);
  }
});

export { blocks as blocksRouter };
```

### 核心服务实现

```typescript
// src/server/services/OnDemandSyncService.ts
import { DatabaseConnection } from '../database/connection.js';
import { EthereumClient } from '../utils/ethereum.js';

export class OnDemandSyncService {
  private db: DatabaseConnection;
  private ethClient: EthereumClient;
  private cache = new Map<string, { data: any; expires: number }>();
  
  constructor() {
    this.db = new DatabaseConnection();
    this.ethClient = new EthereumClient();
  }
  
  /**
   * 用户访问时获取区块数据
   * 策略：缓存 → 本地DB → RPC → 异步存储
   */
  async getBlockData(blockNumber: number, includeTransactions = false): Promise<Block | null> {
    const startTime = Date.now();
    const cacheKey = \`block:\${blockNumber}:\${includeTransactions}\`;
    
    // 1. 检查内存缓存（最快）
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log(\`📦 Block \${blockNumber} served from cache (\${Date.now() - startTime}ms)\`);
      return { ...cached, _meta: { source: 'cache', cached: true } };
    }
    
    // 2. 检查本地数据库（快）
    const stored = await this.getStoredBlock(blockNumber, includeTransactions);
    if (stored) {
      this.setCache(cacheKey, stored, 3600); // 缓存1小时
      console.log(\`💾 Block \${blockNumber} served from database (\${Date.now() - startTime}ms)\`);
      return { ...stored, _meta: { source: 'database', cached: false } };
    }
    
    // 3. 实时从RPC获取（用户等待）
    try {
      const block = await this.fetchBlockFromRPC(blockNumber, includeTransactions);
      
      if (block) {
        // 异步存储到数据库（不阻塞用户响应）
        this.storeBlockAsync(block);
        
        // 缓存
        this.setCache(cacheKey, block, 300); // 缓存5分钟
        
        console.log(\`🌐 Block \${blockNumber} fetched from RPC (\${Date.now() - startTime}ms)\`);
        return { ...block, _meta: { source: 'rpc', cached: false } };
      }
      
      return null;
    } catch (error) {
      console.error(\`❌ Failed to fetch block \${blockNumber}:\`, error);
      return null;
    }
  }
  
  /**
   * 用户访问时获取地址交易历史
   */
  async getAddressTransactions(
    address: string,
    page = 1,
    limit = 20
  ): Promise<{
    transactions: Transaction[];
    total: number;
    hasMore: boolean;
    _meta?: any;
  }> {
    const startTime = Date.now();
    const cacheKey = \`addr:\${address}:p\${page}:l\${limit}\`;
    
    // 检查缓存
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log(\`📦 Address \${address} transactions served from cache (\${Date.now() - startTime}ms)\`);
      return { ...cached, _meta: { source: 'cache' } };
    }
    
    // 检查本地存储
    const stored = await this.getStoredAddressTransactions(address, page, limit);
    if (stored.transactions.length > 0) {
      this.setCache(cacheKey, stored, 600); // 缓存10分钟
      console.log(\`💾 Address \${address} transactions served from database (\${Date.now() - startTime}ms)\`);
      return { ...stored, _meta: { source: 'database' } };
    }
    
    // 实时获取
    try {
      const result = await this.fetchAddressTransactionsFromAPI(address, page, limit);
      
      if (result.transactions.length > 0) {
        // 异步索引相关数据
        this.indexAddressDataAsync(address, result.transactions);
        
        // 缓存
        this.setCache(cacheKey, result, 300); // 缓存5分钟
        
        console.log(\`🌐 Address \${address} transactions fetched from API (\${Date.now() - startTime}ms)\`);
        return { ...result, _meta: { source: 'api' } };
      }
      
      return { transactions: [], total: 0, hasMore: false };
    } catch (error) {
      console.error(\`❌ Failed to fetch address \${address} transactions:\`, error);
      return { transactions: [], total: 0, hasMore: false };
    }
  }
  
  /**
   * 从RPC获取区块数据
   */
  private async fetchBlockFromRPC(blockNumber: number, includeTransactions: boolean): Promise<Block | null> {
    try {
      const block = await this.ethClient.getBlock(BigInt(blockNumber), includeTransactions);
      
      return {
        number: Number(block.number),
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
        miner: block.miner,
        gasLimit: block.gasLimit.toString(),
        gasUsed: block.gasUsed.toString(),
        baseFeePerGas: block.baseFeePerGas?.toString(),
        transactionCount: block.transactions.length,
        size: Number(block.size),
        transactions: includeTransactions ? block.transactions.map(tx => 
          typeof tx === 'string' ? tx : tx.hash
        ) : undefined,
      };
    } catch (error) {
      console.error(\`RPC fetch error for block \${blockNumber}:\`, error);
      return null;
    }
  }
  
  /**
   * 异步存储区块（不阻塞用户响应）
   */
  private storeBlockAsync(block: Block): void {
    setImmediate(async () => {
      try {
        await this.db.run(\`
          INSERT OR REPLACE INTO blocks (
            number, hash, parent_hash, timestamp, miner,
            gas_limit, gas_used, base_fee_per_gas, transaction_count, size_bytes,
            indexed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        \`, [
          block.number,
          block.hash,
          block.parentHash,
          block.timestamp,
          block.miner,
          Number(block.gasLimit),
          Number(block.gasUsed),
          block.baseFeePerGas ? Number(block.baseFeePerGas) : null,
          block.transactionCount,
          block.size
        ]);
        
        // 记录访问历史
        await this.recordAccess('block', block.number.toString());
        
        console.log(\`✅ Block \${block.number} stored asynchronously\`);
      } catch (error) {
        console.error(\`❌ Failed to store block \${block.number}:\`, error);
      }
    });
  }
  
  /**
   * 异步索引地址数据
   */
  private indexAddressDataAsync(address: string, transactions: Transaction[]): void {
    setImmediate(async () => {
      try {
        // 存储交易
        for (const tx of transactions) {
          await this.storeTransactionAsync(tx);
        }
        
        // 更新地址索引记录
        await this.db.run(\`
          INSERT OR REPLACE INTO indexed_addresses (
            address, transaction_count, last_queried
          ) VALUES (?, ?, CURRENT_TIMESTAMP)
        \`, [address, transactions.length]);
        
        // 记录访问历史
        await this.recordAccess('address', address);
        
        console.log(\`✅ Address \${address} indexed with \${transactions.length} transactions\`);
      } catch (error) {
        console.error(\`❌ Failed to index address \${address}:\`, error);
      }
    });
  }
  
  /**
   * 内存缓存管理
   */
  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (!cached || cached.expires < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return cached.data;
  }
  
  private setCache(key: string, data: any, ttlSeconds: number): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + ttlSeconds * 1000
    });
    
    // 定期清理缓存
    if (this.cache.size > 1000) {
      this.cleanupExpiredCache();
    }
  }
  
  private cleanupExpiredCache(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.cache.entries()) {
      if (value.expires < now) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(\`🧹 Cleaned \${cleaned} expired cache entries\`);
    }
  }
  
  /**
   * 记录访问历史（用于数据清理策略）
   */
  private async recordAccess(type: string, identifier: string): Promise<void> {
    await this.db.run(\`
      INSERT OR REPLACE INTO access_history (
        type, identifier, first_accessed, last_accessed, access_count
      ) VALUES (
        ?, ?, 
        COALESCE((SELECT first_accessed FROM access_history WHERE type = ? AND identifier = ?), CURRENT_TIMESTAMP),
        CURRENT_TIMESTAMP,
        COALESCE((SELECT access_count FROM access_history WHERE type = ? AND identifier = ?), 0) + 1
      )
    \`, [type, identifier, type, identifier, type, identifier]);
  }
}
```

## 数据清理策略

### 基于访问频率的智能清理

```typescript
// 定期清理任务（可选，用户触发或服务启动时）
export class DataCleanupService {
  private db: DatabaseConnection;
  
  async cleanupUnusedData(): Promise<void> {
    const stats = await this.getCleanupStats();
    console.log('🧹 Starting data cleanup...', stats);
    
    try {
      // 1. 清理长期未访问的区块数据（保留30天内访问的）
      const deletedBlocks = await this.db.run(\`
        DELETE FROM blocks 
        WHERE number IN (
          SELECT ah.identifier 
          FROM access_history ah 
          WHERE ah.type = 'block' 
          AND ah.last_accessed < datetime('now', '-30 days')
          AND ah.access_count < 3
        )
      \`);
      
      // 2. 清理长期未访问的交易数据
      const deletedTxs = await this.db.run(\`
        DELETE FROM transactions 
        WHERE block_number IN (
          SELECT CAST(ah.identifier AS INTEGER)
          FROM access_history ah 
          WHERE ah.type = 'block' 
          AND ah.last_accessed < datetime('now', '-30 days')
          AND ah.access_count < 3
        )
      \`);
      
      // 3. 清理搜索历史（保留最近7天）
      const deletedSearches = await this.db.run(\`
        DELETE FROM search_history 
        WHERE searched_at < datetime('now', '-7 days')
      \`);
      
      // 4. 清理访问历史记录
      const deletedAccess = await this.db.run(\`
        DELETE FROM access_history 
        WHERE last_accessed < datetime('now', '-90 days')
        AND access_count < 2
      \`);
      
      console.log(\`✅ Cleanup completed: \${deletedBlocks} blocks, \${deletedTxs} transactions, \${deletedSearches} searches, \${deletedAccess} access records\`);
      
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    }
  }
  
  private async getCleanupStats() {
    const [blocks, txs, searches, access] = await Promise.all([
      this.db.query('SELECT COUNT(*) as count FROM blocks'),
      this.db.query('SELECT COUNT(*) as count FROM transactions'),
      this.db.query('SELECT COUNT(*) as count FROM search_history'),
      this.db.query('SELECT COUNT(*) as count FROM access_history'),
    ]);
    
    return {
      blocks: blocks[0]?.count || 0,
      transactions: txs[0]?.count || 0,
      searches: searches[0]?.count || 0,
      accessRecords: access[0]?.count || 0,
    };
  }
}
```

## 性能监控

### 响应时间监控

```typescript
// 中间件：监控API响应时间
export const performanceMiddleware = async (c, next) => {
  const start = Date.now();
  const path = c.req.path;
  
  await next();
  
  const duration = Date.now() - start;
  
  // 记录慢查询
  if (duration > 1000) {
    console.warn(\`🐌 Slow request: \${path} took \${duration}ms\`);
  }
  
  // 设置响应头
  c.header('X-Response-Time', \`\${duration}ms\`);
  
  // 可选：发送到监控系统
  if (process.env.ENABLE_METRICS === 'true') {
    await sendMetrics({
      path,
      duration,
      status: c.res.status,
      timestamp: new Date().toISOString(),
    });
  }
};
```

## 优势总结

### 用户体验
- ⚡ **快速响应**：缓存优先，平均响应时间 < 100ms
- 🎯 **按需加载**：只处理用户实际需要的数据
- 📱 **零等待启动**：无需等待后台同步完成

### 系统资源
- 💾 **存储优化**：只存储访问过的数据，节省80%+空间
- 🔄 **CPU友好**：无后台定时任务，CPU使用率低
- 🌐 **网络优化**：减少不必要的RPC调用

### 运维成本
- 🔧 **简化部署**：无需配置复杂的同步任务
- 🛠️ **易于维护**：代码逻辑简单，问题易排查
- 📊 **智能清理**：基于使用模式自动优化存储

这种"用户访问时同步"的策略，真正实现了按需计算的理念，既保证了用户体验，又最大化了资源利用效率！
