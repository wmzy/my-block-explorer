# 组件文档

本文档提供了区块链浏览器应用程序中使用的 React 组件的详细信息。

## TopNavigation 组件

`TopNavigation` 组件为应用程序的所有页面提供了统一的导航栏。

### 功能特性

- **全局搜索**：智能搜索输入，可检测地址、交易哈希和区块号
- **链选择器**：下拉菜单，用于在不同的区块链网络之间切换
- **RPC 配置**：快速访问 RPC 节点配置
- **响应式设计**：适配移动端和桌面端屏幕尺寸
- **粘性导航**：滚动时保持可见

### Props

```typescript
type TopNavigationProps = {
  currentChainId: number;
  onChainChange: (chainId: number) => void;
  onSearch: (query: string) => void;
  searchPlaceholder?: string;
};
```

#### Props 说明

- `currentChainId`: 当前选中的区块链网络 ID
- `onChainChange`: 用户切换链时调用的回调函数
- `onSearch`: 用户执行搜索时调用的回调函数
- `searchPlaceholder`: 可选的搜索输入自定义占位符文本

### 使用示例

```tsx
import TopNavigation from './components/TopNavigation';

function App() {
  const [currentChainId, setCurrentChainId] = useState(1);

  const handleChainChange = (newChainId: number) => {
    setCurrentChainId(newChainId);
    // 导航到新链
    navigate(`/chain/${newChainId}`);
  };

  const handleSearch = async (query: string) => {
    // 执行搜索逻辑
    const results = await searchBlockchain(query, currentChainId);
    // 处理结果...
  };

  return (
    <TopNavigation
      currentChainId={currentChainId}
      onChainChange={handleChainChange}
      onSearch={handleSearch}
      searchPlaceholder="搜索地址、交易或区块..."
    />
  );
}
```

### 样式

组件使用 Linaria CSS-in-JS 进行样式设计，包含以下关键类：

- `navStyles`: 主导航容器
- `logoStyles`: Logo 和品牌样式
- `searchContainerStyles`: 搜索输入容器
- `searchInputStyles`: 搜索输入字段
- `searchButtonStyles`: 搜索按钮
- `controlsStyles`: 右侧控件容器
- `rpcConfigButtonStyles`: RPC 配置按钮

### 响应式行为

- **桌面端**：全宽搜索的水平布局
- **移动端**：垂直堆叠元素的布局
- **平板端**：基于屏幕宽度的自适应布局

## ChainSelector 组件

`ChainSelector` 组件（嵌入在 `TopNavigation` 中）提供链切换功能。

### 功能特性

- **搜索功能**：按名称、ID 或代币符号过滤链
- **热门链指示器**：热门链的视觉标记
- **测试网徽章**：测试网链的特殊徽章
- **键盘导航**：支持 Enter 键选择
- **外部点击关闭**：点击外部时自动关闭

### 链数据结构

```typescript
type Chain = {
  id: number;
  name: string;
  nativeCurrency: {
    symbol: string;
  };
};
```

### 链配置

链在 `src/config/chains.ts` 中配置，具有以下辅助函数：

- `getChainInfo(chainId)`: 获取完整链信息
- `getChainName(chainId)`: 获取链显示名称
- `getChainSymbol(chainId)`: 获取原生代币符号
- `isPopularChain(chainId)`: 检查链是否标记为热门
- `getSortedChains()`: 获取按热门度排序的所有链
- `searchChains(query)`: 按查询字符串搜索链

### 在 TopNavigation 中的使用

ChainSelector 自动包含在 TopNavigation 中，不需要单独导入或配置。

## RpcConfigModal 组件

`RpcConfigModal` 组件允许用户为不同的链配置 RPC 端点。

### Props

```typescript
type RpcConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
  chainId: number;
};
```

### 功能特性

- **RPC URL 验证**：验证 RPC 端点连接性
- **链 ID 验证**：确保 RPC 匹配预期链
- **历史数据测试**：测试 RPC 是否支持历史查询
- **事件范围配置**：设置事件查询的最大区块范围
- **错误反馈**：提供带有 cast 命令的详细错误消息

### 使用示例

```tsx
import RpcConfigModal from './components/RpcConfigModal';

function Page() {
  const [showRpcConfig, setShowRpcConfig] = useState(false);
  const currentChainId = 1;

  return (
    <>
      <button onClick={() => setShowRpcConfig(true)}>
        配置 RPC
      </button>

      <RpcConfigModal
        isOpen={showRpcConfig}
        onClose={() => setShowRpcConfig(false)}
        chainId={currentChainId}
      />
    </>
  );
}
```

## RpcFunctionError 组件

`RpcFunctionError` 组件显示具有可操作反馈的函数特定 RPC 错误。

### Props

```typescript
type RpcFunctionErrorProps = {
  functionName: string;
  chainId: number;
  chainName: string;
  error: string;
  onConfigureRpc: () => void;
  onRetry?: () => void;
};
```

### 功能特性

- **函数上下文**：显示哪个函数失败
- **错误分析**：提供详细的错误分析
- **Cast 命令**：生成用于调试的验证命令
- **重试机制**：可选的重试功能
- **配置访问**：直接链接到 RPC 配置

### 使用示例

```tsx
import RpcFunctionError from './components/RpcFunctionError';

function ContractPage() {
  const [creationError, setCreationError] = useState<string | null>(null);

  if (creationError) {
    return (
      <RpcFunctionError
        functionName="getContractCreationInfo"
        chainId={currentChainId}
        chainName="Ethereum"
        error={creationError}
        onConfigureRpc={() => setShowRpcConfig(true)}
        onRetry={fetchContractCreationInfo}
      />
    );
  }

  // ... 组件其余部分
}
```

## 最佳实践

### 组件集成

1. **一致导航**：始终在页面组件顶部包含 `TopNavigation`
2. **链上下文**：将当前链 ID 传递给所有链感知组件
3. **错误处理**：对 RPC 相关故障使用 `RpcFunctionError`
4. **加载状态**：在异步操作期间显示适当的加载指示器

### 性能优化

1. **记忆化**：对接收稳定 props 的组件使用 React.memo
2. **回调优化**：对作为 props 传递的事件处理器使用 useCallback
3. **搜索防抖**：对搜索输入实现防抖以减少 API 调用

### 可访问性

1. **键盘导航**：确保所有交互元素都可以通过键盘访问
2. **ARIA 标签**：为屏幕阅读器提供适当的 ARIA 标签
3. **焦点管理**：在模态框和下拉菜单中适当管理焦点
4. **颜色对比**：确保所有文本元素有足够的颜色对比度

### 测试

1. **单元测试**：测试单个组件行为和 props
2. **集成测试**：测试组件交互和数据流
3. **端到端测试**：测试跨组件的完整用户工作流
4. **可访问性测试**：验证可访问性合规性

### 样式指南

1. **CSS-in-JS**：使用 Linaria 进行组件作用域样式
2. **响应式设计**：采用移动优先的渐进增强设计
3. **主题一致性**：使用一致的颜色、字体和间距
4. **动画**：使用微妙的动画以获得更好的用户体验

## 组件架构

```
src/
├── components/
│   ├── TopNavigation.tsx       # 主导航组件
│   ├── RpcConfigModal.tsx      # RPC 配置模态框
│   ├── RpcFunctionError.tsx    # RPC 错误显示
│   └── BackendRpcConfig.tsx    # 后端 RPC 配置
├── pages/
│   ├── AddressPage.tsx         # 地址详情页面
│   ├── ContractPage.tsx        # 合约详情页面
│   └── BlockPage.tsx           # 区块详情页面
└── config/
    └── chains.ts               # 链配置
```

## 未来增强功能

1. **主题支持**：添加深色/浅色主题切换
2. **书签**：允许用户收藏经常访问的地址
3. **最近搜索**：显示最近的搜索历史
4. **高级搜索**：为搜索结果添加过滤器
5. **通知**：为重要事件添加 Toast 通知
