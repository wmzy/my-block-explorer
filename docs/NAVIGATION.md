# 导航功能文档

## 概述

Block Explorer 的导航系统提供了统一、直观的用户界面，支持多链切换、全局搜索、RPC配置等核心功能。

## 核心组件

### TopNavigation 组件

顶部导航栏是应用的核心导航组件，提供以下功能：

#### 功能特性
- **全局搜索**: 智能识别地址、交易哈希、区块号
- **链切换**: 支持搜索和过滤的链选择器  
- **RPC配置**: 快速访问RPC节点设置
- **响应式设计**: 适配桌面和移动设备
- **粘性布局**: 滚动时保持可见

#### 技术实现
```typescript
// src/components/TopNavigation.tsx
export default function TopNavigation({
  currentChainId,
  onChainChange,
  onSearch,
  searchPlaceholder = "搜索地址、交易哈希或区块号...",
}: TopNavigationProps) {
  // 组件实现
}
```

#### 样式系统
- 使用 Linaria CSS-in-JS
- 响应式断点：768px (移动设备)
- 固定高度：60px
- Z-index：1000 (确保在其他元素之上)

### ChainSelector 组件

嵌入在 TopNavigation 中的链选择器组件。

#### 功能特性
- **搜索过滤**: 按名称、ID、代币符号搜索
- **热门标记**: ⭐ 标识热门链
- **测试网标识**: 特殊样式标识测试网
- **键盘导航**: 支持 Enter 键选择
- **点击外部关闭**: 自动关闭下拉菜单

#### 数据源
```typescript
// src/config/chains.ts
export const getSortedChains = () => [...]; // 按热门度排序
export const searchChains = (query: string) => [...]; // 搜索过滤
export const isPopularChain = (chainId: number) => boolean; // 热门判断
```

## 页面集成

### 集成方式

所有页面组件都集成了 TopNavigation：

```typescript
// 页面组件示例
export default function PageComponent() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();
  
  const currentChainId = parseInt(chainId || "1");
  
  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}/current-path`, { replace: true });
  };
  
  const handleSearch = async (query: string) => {
    // 执行搜索逻辑
  };
  
  return (
    <>
      <TopNavigation
        currentChainId={currentChainId}
        onChainChange={handleChainChange}
        onSearch={handleSearch}
      />
      {/* 页面内容 */}
    </>
  );
}
```

### 路由处理

#### 链切换时的路径保持
- **地址页面**: `/chain/1/address/0x123` → `/chain/137/address/0x123`
- **合约页面**: `/chain/1/contract/0x456` → `/chain/137/contract/0x456`
- **交易页面**: `/chain/1/tx/0x789` → `/chain/137/tx/0x789`
- **区块页面**: `/chain/1/block/12345` → `/chain/137/block/12345`

#### 实现逻辑
```typescript
const handleChainChange = (newChainId: number) => {
  const pathParts = window.location.pathname.split('/');
  if (pathParts.length >= 4 && ['address', 'block', 'tx', 'contract'].includes(pathParts[3])) {
    navigate(`/chain/${newChainId}/${pathParts[3]}/${pathParts[4]}`, { replace: true });
  } else {
    navigate(`/chain/${newChainId}`, { replace: true });
  }
};
```

## 搜索功能

### 搜索类型识别

搜索系统能够智能识别不同类型的输入：

```typescript
// 搜索类型判断逻辑
const detectSearchType = (query: string) => {
  if (/^0x[a-fA-F0-9]{40}$/.test(query)) return 'address';
  if (/^0x[a-fA-F0-9]{64}$/.test(query)) return 'transaction';  
  if (/^\d+$/.test(query) || query === 'latest') return 'block';
  return 'unknown';
};
```

### 搜索流程

1. **输入验证**: 检查输入格式和长度
2. **类型识别**: 自动判断搜索内容类型
3. **API调用**: 调用链特定的搜索API
4. **结果处理**: 根据结果类型进行页面跳转
5. **错误处理**: 显示错误信息和建议

### API端点

```bash
# 链特定搜索
GET /api/chains/{chainId}/search?q={query}

# 通用搜索（回退）
GET /api/search?q={query}
```

## RPC配置

### 配置功能

- **RPC URL验证**: 检查连接性和响应
- **链ID验证**: 确保RPC对应正确的链
- **历史数据检测**: 测试是否支持历史区块查询
- **事件范围配置**: 设置最大区块范围
- **错误诊断**: 提供详细的错误分析

### 配置存储

RPC配置存储在后端数据库中：

```typescript
// 配置数据结构
type RpcConfig = {
  chainId: number;
  rpcUrl: string;
  maxEventRange: number;
  isActive: boolean;
  lastTested: Date;
};
```

### API端点

```bash
# 获取配置
GET /api/rpc-configs

# 保存配置  
POST /api/rpc-configs
{
  "chainId": 1,
  "rpcUrl": "https://example.com/rpc",
  "maxEventRange": 2000
}

# 测试配置
POST /api/rpc-configs/test
{
  "chainId": 1,
  "rpcUrl": "https://example.com/rpc"
}
```

## 错误处理

### RPC错误处理

当RPC相关功能失败时，系统提供详细的错误反馈：

```typescript
// RpcFunctionError 组件
<RpcFunctionError
  functionName="getContractCreationInfo"
  chainId={currentChainId}
  chainName="Ethereum"
  error={errorMessage}
  onConfigureRpc={() => setShowRpcConfig(true)}
  onRetry={retryFunction}
/>
```

### 错误类型

1. **连接错误**: RPC节点无法连接
2. **链ID不匹配**: RPC返回的链ID与预期不符
3. **功能不支持**: RPC不支持特定功能（如历史查询）
4. **限制错误**: 超出RPC的查询限制
5. **数据错误**: 返回的数据格式不正确

### 错误反馈

- **Cast命令**: 提供用于验证的cast命令
- **重试机制**: 支持用户重试失败的操作
- **配置建议**: 引导用户配置替代RPC
- **详细日志**: 在控制台输出详细错误信息

## 性能优化

### 缓存策略

1. **组件缓存**: 使用 React.memo 缓存稳定组件
2. **搜索缓存**: 缓存最近的搜索结果
3. **链数据缓存**: 缓存链配置信息
4. **RPC响应缓存**: 缓存RPC查询结果

### 懒加载

1. **链数据**: 按需加载链特定数据
2. **搜索结果**: 分页加载大量结果
3. **组件**: 动态导入非关键组件

### 防抖优化

```typescript
// 搜索输入防抖
const debouncedSearch = useCallback(
  debounce((query: string) => {
    performSearch(query);
  }, 300),
  []
);
```

## 测试策略

### 单元测试

- **组件渲染**: 测试组件正确渲染
- **用户交互**: 测试点击、输入等交互
- **状态管理**: 测试状态变化和更新
- **错误处理**: 测试错误情况的处理

### 集成测试

- **API集成**: 测试前后端API交互
- **路由集成**: 测试页面间导航
- **搜索流程**: 测试完整搜索流程
- **链切换**: 测试链切换功能

### E2E测试

- **用户工作流**: 测试完整用户场景
- **跨页面导航**: 测试页面间的导航流程
- **错误恢复**: 测试错误情况下的用户体验

## 可访问性

### 键盘导航

- **Tab导航**: 所有交互元素支持Tab导航
- **Enter激活**: 支持Enter键激活按钮
- **Escape关闭**: 支持Escape键关闭模态框
- **方向键**: 在列表中使用方向键导航

### 屏幕阅读器

- **ARIA标签**: 为复杂组件提供ARIA标签
- **语义化HTML**: 使用语义化HTML元素
- **状态描述**: 描述动态状态变化
- **错误公告**: 公告错误和成功消息

### 视觉设计

- **颜色对比**: 确保足够的颜色对比度
- **焦点指示**: 清晰的焦点指示器
- **字体大小**: 支持用户字体大小设置
- **动画控制**: 支持禁用动画的用户偏好

## 未来改进

### 功能增强

1. **搜索历史**: 保存和显示搜索历史
2. **收藏功能**: 收藏常用地址和交易
3. **主题切换**: 支持深色/浅色主题
4. **多语言**: 支持多语言界面
5. **通知系统**: 实时通知和提醒

### 性能提升

1. **虚拟滚动**: 大列表的虚拟滚动
2. **预加载**: 预加载可能访问的数据
3. **CDN优化**: 静态资源CDN加速
4. **服务工作器**: 离线支持和缓存

### 用户体验

1. **加载动画**: 更好的加载状态指示
2. **过渡动画**: 页面间的平滑过渡
3. **手势支持**: 移动设备手势操作
4. **快捷键**: 高级用户快捷键支持
