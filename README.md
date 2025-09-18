# Block Explorer

一个现代化的多链区块链浏览器，基于 DuckDB 和 Viem 构建，支持 Ethereum 及兼容网络。

## ✨ 特性

- 🚀 **高性能**: 基于 DuckDB 的列式存储，快速查询和分析
- 🔗 **多链支持**: 支持 Ethereum, Polygon, BSC, Arbitrum, Base, Optimism
- 📱 **响应式设计**: 现代化的用户界面，支持移动端
- ⚡ **按需索引**: 只索引用户访问的数据，降低存储成本
- 🔍 **智能搜索**: 自动识别搜索类型（地址/交易/区块）
- 🛠️ **零配置**: 前端自动发现本地服务，开箱即用
- 🎨 **类型安全**: 完整的 TypeScript 支持

## 🏗️ 技术栈

### 前端
- **React 19** - 用户界面库
- **React Router v7.5** - 路由管理
- **Vite 6** - 构建工具
- **Linaria 6.2** - CSS-in-JS 样式方案 (基于 wyw-in-js)
- **ECharts 5.5** - 数据可视化
- **TypeScript 5.7** - 类型安全

### 后端
- **Hono 5.0** - 轻量级 Web 框架
- **Node.js 22** - 运行时环境
- **DuckDB 1.1** - 嵌入式分析数据库
- **Drizzle ORM 0.36** - 类型安全的 ORM
- **Viem 2.21** - 以太坊开发库
- **Pino 9.5** - 高性能日志库

### 部署
- **Cloudflare Pages** - 前端静态托管
- **本地服务器** - 后端 API 服务

## 🚀 快速开始

### 环境要求

- Node.js 22+
- npm 或 pnpm

### 安装和运行

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd block-explorer
   ```

2. **安装依赖**
   ```bash
   pnpm install
   ```

3. **环境配置**
   ```bash
   cp .env.example .env
   # 编辑 .env 文件，配置必要的环境变量
   ```

4. **启动开发服务**
   ```bash
   # 同时启动前端和后端
   pnpm dev
   
   # 或分别启动
   pnpm dev:client  # 前端开发服务器 (http://localhost:3000)
   pnpm dev:server  # 后端 API 服务器 (http://localhost:8201)
   ```

5. **访问应用**
   - 前端: http://localhost:3000
   - 后端 API: http://localhost:8201/api

### 数据库管理

```bash
# 生成数据库迁移
pnpm db:generate

# 执行迁移
pnpm db:migrate

# 数据库可视化管理
pnpm db:studio
```

## 📁 项目结构

```
block-explorer/
├── src/
│   ├── shared/          # 共享类型和工具
│   │   ├── types/       # TypeScript 类型定义
│   │   ├── utils/       # 工具函数
│   │   └── config/      # 链配置
│   ├── server/          # 后端代码
│   │   ├── database/    # 数据库相关
│   │   ├── services/    # 业务逻辑层
│   │   ├── routes/      # API 路由
│   │   └── middleware/  # 中间件
│   └── client/          # 前端代码
│       ├── components/  # React 组件
│       ├── pages/       # 页面组件
│       ├── hooks/       # 自定义 Hooks
│       └── api/         # API 客户端
├── docs/               # 文档
├── dist/              # 构建输出
└── data/              # 数据库文件
```

## 🔗 API 端点

### 区块相关
- `GET /api/chains/{chainId}/blocks` - 获取最新区块列表
- `GET /api/chains/{chainId}/blocks/{blockNumber}` - 根据区块号获取区块
- `GET /api/chains/{chainId}/blocks/hash/{blockHash}` - 根据哈希获取区块

### 交易相关
- `GET /api/chains/{chainId}/transactions/{txHash}` - 获取交易详情
- `GET /api/chains/{chainId}/addresses/{address}/transactions` - 获取地址交易

### 地址相关
- `GET /api/chains/{chainId}/addresses/{address}` - 获取地址信息
- `GET /api/chains/{chainId}/addresses/{address}/balance` - 获取地址余额

### 搜索和统计
- `GET /api/search?q={query}` - 通用搜索
- `GET /api/stats/overview` - 系统概览统计
- `GET /api/health` - 健康检查

## 🔧 配置说明

### 环境变量

```bash
# 基础配置
NODE_ENV=development
CLIENT_PORT=3000
SERVER_PORT=8201

# 数据库配置
DATABASE_URL=duckdb://data/blockchain.db

# RPC 配置 (可选)
ALCHEMY_API_KEY=your_key
INFURA_API_KEY=your_key
```

### 链配置

系统默认支持以下链：

| 链名称 | Chain ID | 符号 | RPC |
|--------|----------|------|-----|
| Ethereum | 1 | ETH | Alchemy/Infura |
| Polygon | 137 | MATIC | Polygon RPC |
| BSC | 56 | BNB | BSC RPC |
| Arbitrum | 42161 | ETH | Arbitrum RPC |
| Base | 8453 | ETH | Base RPC |
| Optimism | 10 | ETH | Optimism RPC |

## 🏠 部署

### 前端部署 (Cloudflare Pages)

1. **构建前端**
   ```bash
   pnpm build:client
   ```

2. **部署到 Cloudflare Pages**
   - 将 `dist/client` 目录部署到 Cloudflare Pages
   - 配置 `_redirects` 文件支持 SPA 路由

### 后端部署 (本地服务器)

1. **构建后端**
   ```bash
   pnpm build:server
   ```

2. **启动生产服务**
   ```bash
   pnpm start:server
   ```

## 🧪 测试

```bash
# 运行测试
pnpm test

# 运行测试并显示覆盖率
pnpm test:coverage

# 运行测试 UI
pnpm test:ui
```

## 📊 核心架构

### DuckDB-PostgreSQL 适配器

项目实现了一个创新的适配器，让 Drizzle ORM 可以直接使用 DuckDB：

```typescript
// 适配器核心实现
export class DuckDBPostgresAdapter {
  async query(sql: string, ...params: any[]): Promise<any[]> {
    // 将 PostgreSQL 查询转换为 DuckDB 兼容格式
  }
  
  async begin(callback: Function): Promise<any> {
    // 事务支持
  }
}
```

### 按需索引策略

- **用户驱动**: 只有用户访问的数据才会被索引
- **智能缓存**: 内存缓存热点数据，提高响应速度
- **增量同步**: 支持增量数据同步，减少资源消耗

### 多链架构

- **统一存储**: 单个 DuckDB 文件存储所有链的数据
- **链维度**: 使用 `chain_id` 作为数据分区维度
- **通用服务**: 所有服务都是链无关的，提高代码复用

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🔗 相关链接

- [DuckDB 文档](https://duckdb.org/docs/)
- [Viem 文档](https://viem.sh/)
- [Drizzle ORM 文档](https://orm.drizzle.team/)
- [Hono 文档](https://hono.dev/)