# 链切换功能说明

## 功能概述

Block Explorer 现在支持多链切换功能，用户可以在不同的区块链网络之间无缝切换，每个链都有独立的URL路径。

## 功能特性

### 🔗 **支持的区块链网络**

| 网络 | Chain ID | 原生代币 | URL路径 |
|------|----------|----------|---------|
| Ethereum | 1 | ETH | `/chain/1` |
| Polygon | 137 | POL | `/chain/137` |
| BSC | 56 | BNB | `/chain/56` |
| Arbitrum | 42161 | ETH | `/chain/42161` |
| Base | 8453 | ETH | `/chain/8453` |
| Optimism | 10 | ETH | `/chain/10` |

### 🎯 **核心功能**

#### 1. **顶部导航栏**
- **位置**: 页面顶部，固定显示
- **组件**: 包含Logo、搜索框、RPC配置、链切换器
- **响应式**: 支持桌面和移动设备
- **粘性设计**: 滚动时保持可见

#### 2. **链切换器**
- **位置**: 顶部导航栏右侧
- **功能**: 下拉菜单选择不同的区块链网络，支持搜索过滤
- **显示**: 当前链名称 + Chain ID + 原生代币符号
- **特色功能**: 
  - 热门链标记 (⭐)
  - 测试网标识
  - 搜索过滤功能
  - 键盘导航支持

#### 3. **全局搜索**
- **位置**: 顶部导航栏中央
- **功能**: 智能识别搜索内容类型（地址、交易、区块）
- **特性**: 
  - 自动完成和建议
  - 搜索历史
  - 链特定搜索
  - Enter键快捷搜索

#### 4. **RPC配置**
- **位置**: 顶部导航栏，搜索框右侧
- **功能**: 快速访问RPC节点配置
- **特性**:
  - 链特定配置
  - 连接性验证
  - 历史数据支持检测
  - 错误诊断和反馈

#### 5. **URL路由集成**
- **格式**: `/chain/{chainId}`
- **示例**: 
  - 以太坊主网: `http://localhost:3000/chain/1`
  - Polygon: `http://localhost:3000/chain/137`
  - BSC: `http://localhost:3000/chain/56`

#### 6. **链特定搜索**
- **API端点**: `/api/chains/{chainId}/search?q={query}`
- **功能**: 每个链都有独立的搜索功能
- **回退**: 如果链特定API不可用，自动回退到通用搜索

#### 7. **链状态显示**
- **当前链信息**: 显示链名称、Chain ID、原生代币
- **状态指示器**: 绿色圆点表示链连接正常
- **搜索提示**: 搜索框显示当前链的搜索提示

## 使用方法

### 🚀 **基本使用**

1. **访问应用**
   ```
   http://localhost:3000
   ```
   - 自动重定向到以太坊主网 (`/chain/1`)

2. **切换链**
   - 点击右上角的链选择器
   - 从下拉菜单中选择目标链
   - URL自动更新，页面内容切换

3. **直接访问特定链**
   ```
   http://localhost:3000/chain/137  # Polygon
   http://localhost:3000/chain/56   # BSC
   ```

4. **在特定链上搜索**
   - 选择目标链
   - 在搜索框中输入地址、交易哈希或区块号
   - 点击搜索按钮

### 🔍 **搜索功能**

#### 支持的搜索类型：
- **地址**: `0x742d35Cc6634C0532925a3b8D489319BaAE7fe82`
- **交易哈希**: `0x1234...` (64位十六进制)
- **区块号**: `12345` (纯数字)

#### API调用示例：
```bash
# 在以太坊主网搜索地址
curl "http://localhost:3000/api/chains/1/search?q=0x742d35Cc6634C0532925a3b8D489319BaAE7fe82"

# 在Polygon搜索区块
curl "http://localhost:3000/api/chains/137/search?q=12345"
```

## 技术实现

### 📁 **文件结构**

```
src/
├── App.tsx                 # 主应用组件，包含路由和链切换
├── main.tsx               # 应用入口
├── config/chains.ts       # 链配置和工具函数
└── api-app.ts            # API路由，包含链特定搜索
```

### 🔧 **核心组件**

#### 1. **TopNavigation 组件**
```typescript
function TopNavigation({ 
  currentChainId,
  onChainChange,
  onSearch,
  searchPlaceholder 
}: { 
  currentChainId: number; 
  onChainChange: (chainId: number) => void;
  onSearch: (query: string) => void;
  searchPlaceholder?: string;
})
```

#### 2. **ChainSelector 组件** (嵌入在 TopNavigation 中)
```typescript
function ChainSelector({ 
  currentChainId, 
  onChainChange 
}: { 
  currentChainId: number; 
  onChainChange: (chainId: number) => void;
})
```

#### 3. **路由配置**
```typescript
<Routes>
  <Route path="/chain/:chainId" element={<HomePage />} />
  <Route path="/" element={<Navigate to="/chain/1" replace />} />
  <Route path="*" element={<Navigate to="/chain/1" replace />} />
</Routes>
```

#### 4. **API路由**
```typescript
app.get("/api/chains/:chainId/search", (c) => {
  // 链特定搜索逻辑
});
```

### 🛠️ **工具函数**

```typescript
// config/chains.ts
export function getChainInfo(chainId: number): Chain | null
export function getChainName(chainId: number): string  
export function getChainSymbol(chainId: number): string
export function isChainSupported(chainId: number): boolean
```

## 开发指南

### 🔨 **添加新链**

1. **更新链配置**
   ```typescript
   // config/chains.ts
   import { newChain } from 'viem/chains';
   
   export const SUPPORTED_CHAINS: Chain[] = [
     // ... 现有链
     newChain,
   ];
   ```

2. **测试新链**
   ```bash
   # 测试新链的搜索API
   curl "http://localhost:3000/api/chains/{NEW_CHAIN_ID}/search?q=test"
   ```

### 🧪 **测试**

#### 功能测试：
```bash
# 1. 测试API健康状态
curl http://localhost:3000/api/health

# 2. 测试链切换API
curl http://localhost:3000/api/chains/1/search?q=0x123...
curl http://localhost:3000/api/chains/137/search?q=12345

# 3. 测试前端页面
curl http://localhost:3000/
curl http://localhost:3000/chain/1
curl http://localhost:3000/chain/137
```

#### 错误处理测试：
```bash
# 不支持的链
curl http://localhost:3000/api/chains/999/search?q=test

# 缺少查询参数
curl http://localhost:3000/api/chains/1/search
```

## 未来扩展

### 🚀 **计划功能**

1. **链状态监控**
   - 实时显示链的连接状态
   - RPC延迟监控
   - 区块高度同步状态

2. **用户偏好**
   - 记住用户最后选择的链
   - 自定义链列表顺序
   - 收藏常用链

3. **高级搜索**
   - 跨链搜索
   - 批量查询
   - 历史搜索记录

4. **链特定功能**
   - 每个链的特殊功能
   - 链特定的代币标准
   - 链特定的合约交互

### 🔧 **技术优化**

1. **性能优化**
   - 链数据缓存
   - 懒加载链配置
   - 搜索结果缓存

2. **用户体验**
   - 链切换动画
   - 加载状态指示
   - 错误状态处理

---

**开发状态**: ✅ 已完成基础功能  
**测试状态**: ✅ API和前端功能正常  
**部署状态**: 🚀 开发环境运行正常
