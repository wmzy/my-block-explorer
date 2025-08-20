# 前端API客户端实现

## 新的API响应格式

基于你的建议，我们移除了冗余的 `success` 字段和 `meta` 对象，改用标准的HTTP状态码和响应头来传递元数据。

## 响应格式对比

### 🚫 旧格式（冗余）
```json
// 成功响应
{
  "success": true,
  "data": { /* 实际数据 */ },
  "meta": { /* 元数据 */ }
}

// 错误响应
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Block not found"
  }
}
```

### ✅ 新格式（简洁）
```http
// 成功响应
HTTP/1.1 200 OK
Content-Type: application/json
X-Response-Time: 45ms
X-Data-Source: cache

{ /* 直接返回数据 */ }

// 错误响应
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "code": "RESOURCE_NOT_FOUND",
  "message": "Block not found"
}
```

## 前端API客户端实现

### 基础API客户端

```typescript
// src/client/api/client.ts
export class ApiClient {
  private baseURL: string;
  
  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }
  
  /**
   * 通用GET请求，返回数据和元数据
   */
  async get<T>(path: string): Promise<ApiResult<T>> {
    const response = await fetch(\`\${this.baseURL}\${path}\`, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    
    // 错误处理
    if (!response.ok) {
      await this.handleError(response);
    }
    
    const data = await response.json();
    const metadata = this.extractMetadata(response);
    
    return {
      data,
      metadata,
      status: response.status,
    };
  }
  
  /**
   * 列表数据专用GET请求
   */
  async getList<T>(path: string): Promise<ListResult<T>> {
    const result = await this.get<ListResponse<T>>(path);
    
    return {
      data: result.data.data,
      pagination: result.data.pagination,
      metadata: result.metadata,
      status: result.status,
    };
  }
  
  /**
   * 从响应头提取元数据
   */
  private extractMetadata(response: Response): ApiMetadata {
    return {
      responseTime: response.headers.get('X-Response-Time') || '',
      dataSource: response.headers.get('X-Data-Source') as DataSource || 'unknown',
      cacheStatus: response.headers.get('X-Cache-Status') as CacheStatus || 'unknown',
      apiVersion: response.headers.get('X-API-Version') || '',
      requestId: response.headers.get('X-Request-ID') || '',
      timestamp: response.headers.get('X-Timestamp') || '',
      totalCount: response.headers.get('X-Total-Count') 
        ? parseInt(response.headers.get('X-Total-Count')!) 
        : undefined,
    };
  }
  
  /**
   * 统一错误处理
   */
  private async handleError(response: Response): Promise<never> {
    try {
      const errorData = await response.json();
      throw new ApiError(
        errorData.code || 'UNKNOWN_ERROR',
        errorData.message || 'Unknown error occurred',
        response.status,
        errorData.details
      );
    } catch (e) {
      // 如果响应不是JSON格式
      throw new ApiError(
        'PARSE_ERROR',
        \`HTTP \${response.status}: \${response.statusText}\`,
        response.status
      );
    }
  }
}

// 类型定义
export type ApiResult<T> = {
  data: T;
  metadata: ApiMetadata;
  status: number;
};

export type ListResult<T> = {
  data: T[];
  pagination: PaginationInfo;
  metadata: ApiMetadata;
  status: number;
};

export type ListResponse<T> = {
  data: T[];
  pagination: PaginationInfo;
};

export type ApiMetadata = {
  responseTime: string;
  dataSource: DataSource;
  cacheStatus: CacheStatus;
  apiVersion: string;
  requestId: string;
  timestamp: string;
  totalCount?: number;
};

export type DataSource = 'cache' | 'database' | 'rpc' | 'api' | 'mixed' | 'unknown';
export type CacheStatus = 'hit' | 'miss' | 'unknown';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
  
  get isNotFound(): boolean {
    return this.status === 404;
  }
  
  get isServerError(): boolean {
    return this.status >= 500;
  }
  
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}
```

### 具体资源的API客户端

```typescript
// src/client/api/blocks.ts
import { ApiClient } from './client.js';
import type { Block } from '@/shared/types/blockchain.js';

export class BlocksApi {
  constructor(private client: ApiClient) {}
  
  /**
   * 获取最新区块
   */
  async getLatest(): Promise<ApiResult<Block>> {
    return this.client.get<Block>('/api/blocks/latest');
  }
  
  /**
   * 获取指定区块
   */
  async getByNumber(blockNumber: number): Promise<ApiResult<Block>> {
    return this.client.get<Block>(\`/api/blocks/\${blockNumber}\`);
  }
  
  /**
   * 获取区块列表
   */
  async getList(params: {
    page?: number;
    limit?: number;
    sort?: string;
    order?: 'asc' | 'desc';
  } = {}): Promise<ListResult<Block>> {
    const searchParams = new URLSearchParams();
    
    if (params.page) searchParams.set('page', params.page.toString());
    if (params.limit) searchParams.set('limit', params.limit.toString());
    if (params.sort) searchParams.set('sort', params.sort);
    if (params.order) searchParams.set('order', params.order);
    
    const query = searchParams.toString();
    const path = query ? \`/api/blocks?\${query}\` : '/api/blocks';
    
    return this.client.getList<Block>(path);
  }
}

// 使用示例
const apiClient = new ApiClient('http://localhost:3001');
const blocksApi = new BlocksApi(apiClient);

// 获取最新区块
try {
  const result = await blocksApi.getLatest();
  
  console.log('Block data:', result.data);
  console.log('Response time:', result.metadata.responseTime);
  console.log('Data source:', result.metadata.dataSource);
  console.log('Cache status:', result.metadata.cacheStatus);
  
  // 根据数据源显示不同的UI提示
  if (result.metadata.dataSource === 'rpc') {
    showToast('📡 Data fetched from blockchain network');
  } else if (result.metadata.cacheStatus === 'hit') {
    showToast('⚡ Data served from cache');
  }
  
} catch (error) {
  if (error instanceof ApiError) {
    if (error.isNotFound) {
      showError('Block not found');
    } else if (error.isServerError) {
      showError('Server error, please try again later');
    } else {
      showError(\`Error: \${error.message}\`);
    }
  }
}
```

### React Hook 封装

```typescript
// src/client/hooks/useApi.ts
import { useState, useEffect, useCallback } from 'react';
import { ApiClient, ApiResult, ApiError } from '@/api/client';

export function useApiData<T>(
  apiCall: () => Promise<ApiResult<T>>,
  dependencies: any[] = []
) {
  const [data, setData] = useState<T | null>(null);
  const [metadata, setMetadata] = useState<ApiMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const result = await apiCall();
      setData(result.data);
      setMetadata(result.metadata);
      
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(
        'UNKNOWN_ERROR',
        err instanceof Error ? err.message : 'Unknown error',
        500
      ));
    } finally {
      setLoading(false);
    }
  }, dependencies);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  return {
    data,
    metadata,
    loading,
    error,
    refetch: fetchData,
  };
}

// 使用示例
function BlockDetail({ blockNumber }: { blockNumber: number }) {
  const { data: block, metadata, loading, error } = useApiData(
    () => blocksApi.getByNumber(blockNumber),
    [blockNumber]
  );
  
  if (loading) return <div>Loading...</div>;
  
  if (error) {
    return (
      <div className="error">
        <h3>Error loading block</h3>
        <p>{error.message}</p>
        {error.isNotFound && (
          <p>Block #{blockNumber} does not exist</p>
        )}
      </div>
    );
  }
  
  return (
    <div className="block-detail">
      <h2>Block #{block?.number}</h2>
      <p>Hash: {block?.hash}</p>
      
      {/* 显示元数据 */}
      <div className="metadata">
        <span>Response: {metadata?.responseTime}</span>
        <span>Source: {metadata?.dataSource}</span>
        {metadata?.cacheStatus === 'hit' && (
          <span className="cache-hit">⚡ Cached</span>
        )}
      </div>
    </div>
  );
}
```

### 错误处理中间件

```typescript
// src/client/api/middleware.ts
export class ApiClientWithMiddleware extends ApiClient {
  private interceptors: {
    request: RequestInterceptor[];
    response: ResponseInterceptor[];
    error: ErrorInterceptor[];
  } = {
    request: [],
    response: [],
    error: [],
  };
  
  addRequestInterceptor(interceptor: RequestInterceptor) {
    this.interceptors.request.push(interceptor);
  }
  
  addResponseInterceptor(interceptor: ResponseInterceptor) {
    this.interceptors.response.push(interceptor);
  }
  
  addErrorInterceptor(interceptor: ErrorInterceptor) {
    this.interceptors.error.push(interceptor);
  }
  
  async get<T>(path: string): Promise<ApiResult<T>> {
    // 应用请求拦截器
    let modifiedPath = path;
    for (const interceptor of this.interceptors.request) {
      modifiedPath = await interceptor(modifiedPath);
    }
    
    try {
      const result = await super.get<T>(modifiedPath);
      
      // 应用响应拦截器
      let modifiedResult = result;
      for (const interceptor of this.interceptors.response) {
        modifiedResult = await interceptor(modifiedResult);
      }
      
      return modifiedResult;
      
    } catch (error) {
      // 应用错误拦截器
      let handledError = error;
      for (const interceptor of this.interceptors.error) {
        handledError = await interceptor(handledError);
      }
      
      throw handledError;
    }
  }
}

type RequestInterceptor = (path: string) => Promise<string> | string;
type ResponseInterceptor = <T>(result: ApiResult<T>) => Promise<ApiResult<T>> | ApiResult<T>;
type ErrorInterceptor = (error: any) => Promise<any> | any;

// 使用示例
const apiClient = new ApiClientWithMiddleware('http://localhost:3001');

// 添加性能监控拦截器
apiClient.addResponseInterceptor((result) => {
  const responseTime = parseInt(result.metadata.responseTime.replace('ms', ''));
  if (responseTime > 1000) {
    console.warn(\`Slow API response: \${responseTime}ms\`);
  }
  return result;
});

// 添加错误日志拦截器
apiClient.addErrorInterceptor((error) => {
  if (error instanceof ApiError) {
    console.error('API Error:', {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    });
  }
  return error;
});
```

## 优势总结

### 1. 更简洁的响应格式
- ❌ 移除冗余的 `success` 字段
- ❌ 移除冗余的 `meta` 对象
- ✅ 使用标准HTTP状态码
- ✅ 元数据放在响应头中

### 2. 更好的开发体验
- 🔍 **类型安全**：完整的TypeScript类型定义
- 🎯 **专用方法**：针对不同数据类型的专用API
- 🛠️ **错误处理**：统一的错误处理机制
- 📊 **元数据访问**：方便的元数据提取

### 3. 更符合RESTful标准
- 📋 **状态码**：正确使用HTTP状态码
- 📤 **响应头**：合理使用自定义响应头
- 🎨 **资源导向**：清晰的资源路径设计
- 🔧 **幂等性**：GET请求的幂等性保证

### 4. 更好的性能监控
- ⏱️ **响应时间**：每个请求的响应时间
- 📦 **数据源**：明确数据来源（缓存/数据库/RPC）
- 💾 **缓存状态**：缓存命中状态
- 📈 **总数信息**：列表请求的总数信息

这种设计让API更加简洁、标准，同时保持了丰富的元数据信息供前端使用！
