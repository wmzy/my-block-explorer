# 自动发现与配置系统

## 概述

前端应用启动时会自动扫描本地端口发现后端服务，如果未找到则引导用户安装或配置远程API服务。

## 自动发现机制

### 1. 端口扫描逻辑

```typescript
// src/client/lib/serviceDiscovery.ts
export class ServiceDiscovery {
  private static readonly DEFAULT_PORTS = [3001, 3002, 3003, 8001, 8080];
  private static readonly SCAN_TIMEOUT = 2000; // 2秒超时
  private static readonly HEALTH_CHECK_PATH = '/api/health';
  
  static async discoverLocalService(): Promise<ServiceConfig | null> {
    console.log('🔍 Scanning for local API service...');
    
    for (const port of this.DEFAULT_PORTS) {
      try {
        const serviceUrl = `http://localhost:${port}`;
        const isAvailable = await this.checkServiceHealth(serviceUrl);
        
        if (isAvailable) {
          console.log(`✅ Found local service at ${serviceUrl}`);
          return {
            type: 'local',
            baseURL: serviceUrl,
            port,
            features: await this.getServiceFeatures(serviceUrl),
          };
        }
      } catch (error) {
        // 忽略连接错误，继续扫描
        continue;
      }
    }
    
    console.log('❌ No local service found');
    return null;
  }
  
  private static async checkServiceHealth(baseURL: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.SCAN_TIMEOUT);
      
      const response = await fetch(`${baseURL}${this.HEALTH_CHECK_PATH}`, {
        method: 'GET',
        signal: controller.signal,
        mode: 'cors',
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const health = await response.json();
        return health.success && health.data?.status === 'healthy';
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }
  
  private static async getServiceFeatures(baseURL: string): Promise<ServiceFeatures> {
    try {
      const response = await fetch(`${baseURL}/api/features`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.warn('Could not fetch service features:', error);
    }
    
    return {
      indexing: true,
      search: true,
      analytics: false,
    };
  }
}

export type ServiceConfig = {
  type: 'local' | 'remote';
  baseURL: string;
  port?: number;
  features: ServiceFeatures;
  name?: string;
};

export type ServiceFeatures = {
  indexing: boolean;
  search: boolean;
  analytics: boolean;
  customEndpoints?: string[];
};
```

### 2. 配置管理

```typescript
// src/client/lib/configManager.ts
export class ConfigManager {
  private static readonly CONFIG_KEY = 'block-explorer-config';
  
  static saveConfig(config: ServiceConfig): void {
    localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config));
  }
  
  static loadConfig(): ServiceConfig | null {
    try {
      const saved = localStorage.getItem(this.CONFIG_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }
  
  static clearConfig(): void {
    localStorage.removeItem(this.CONFIG_KEY);
  }
  
  static async validateConfig(config: ServiceConfig): Promise<boolean> {
    try {
      const response = await fetch(`${config.baseURL}/api/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

### 3. 应用初始化

```typescript
// src/client/hooks/useServiceSetup.ts
import { useState, useEffect } from 'react';
import { ServiceDiscovery, ServiceConfig } from '@/lib/serviceDiscovery';
import { ConfigManager } from '@/lib/configManager';

export type SetupStatus = 'loading' | 'local-found' | 'remote-configured' | 'setup-required';

export function useServiceSetup() {
  const [status, setStatus] = useState<SetupStatus>('loading');
  const [serviceConfig, setServiceConfig] = useState<ServiceConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    initializeService();
  }, []);
  
  const initializeService = async () => {
    try {
      setStatus('loading');
      setError(null);
      
      // 1. 检查已保存的配置
      const savedConfig = ConfigManager.loadConfig();
      if (savedConfig) {
        const isValid = await ConfigManager.validateConfig(savedConfig);
        if (isValid) {
          setServiceConfig(savedConfig);
          setStatus(savedConfig.type === 'local' ? 'local-found' : 'remote-configured');
          return;
        } else {
          // 清除无效配置
          ConfigManager.clearConfig();
        }
      }
      
      // 2. 自动发现本地服务
      const localService = await ServiceDiscovery.discoverLocalService();
      if (localService) {
        setServiceConfig(localService);
        setStatus('local-found');
        ConfigManager.saveConfig(localService);
        return;
      }
      
      // 3. 需要用户配置
      setStatus('setup-required');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('setup-required');
    }
  };
  
  const configureRemoteService = async (url: string, name?: string) => {
    try {
      const remoteConfig: ServiceConfig = {
        type: 'remote',
        baseURL: url.replace(/\/$/, ''), // 移除尾部斜杠
        features: { indexing: true, search: true, analytics: false },
        name: name || 'Remote API',
      };
      
      const isValid = await ConfigManager.validateConfig(remoteConfig);
      if (!isValid) {
        throw new Error('Unable to connect to remote service');
      }
      
      setServiceConfig(remoteConfig);
      setStatus('remote-configured');
      ConfigManager.saveConfig(remoteConfig);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure remote service');
      throw err;
    }
  };
  
  const resetConfiguration = () => {
    ConfigManager.clearConfig();
    setServiceConfig(null);
    setStatus('loading');
    initializeService();
  };
  
  return {
    status,
    serviceConfig,
    error,
    configureRemoteService,
    resetConfiguration,
    refresh: initializeService,
  };
}
```

### 4. 设置界面组件

```typescript
// src/client/components/ServiceSetup/ServiceSetup.tsx
import React, { useState } from 'react';
import { styled } from '@linaria/react';
import { useServiceSetup } from '@/hooks/useServiceSetup';

export const ServiceSetup: React.FC = () => {
  const { status, serviceConfig, error, configureRemoteService, resetConfiguration } = useServiceSetup();
  const [remoteUrl, setRemoteUrl] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [isConfiguring, setIsConfiguring] = useState(false);
  
  if (status === 'loading') {
    return <LoadingScreen />;
  }
  
  if (status === 'local-found' || status === 'remote-configured') {
    return (
      <Container>
        <SuccessCard>
          <h2>✅ Service Connected</h2>
          <ServiceInfo>
            <p><strong>Type:</strong> {serviceConfig?.type}</p>
            <p><strong>URL:</strong> {serviceConfig?.baseURL}</p>
            {serviceConfig?.name && <p><strong>Name:</strong> {serviceConfig.name}</p>}
          </ServiceInfo>
          <ButtonGroup>
            <SecondaryButton onClick={resetConfiguration}>
              Change Configuration
            </SecondaryButton>
          </ButtonGroup>
        </SuccessCard>
      </Container>
    );
  }
  
  return (
    <Container>
      <SetupCard>
        <h1>🔍 Block Explorer Setup</h1>
        <p>No local API service detected. Choose one of the options below:</p>
        
        {error && <ErrorMessage>{error}</ErrorMessage>}
        
        <OptionSection>
          <h3>Option 1: Install Local Service (Recommended)</h3>
          <p>Run your own API service for the best performance and privacy.</p>
          <InstallSteps>
            <Step>
              <StepNumber>1</StepNumber>
              <StepContent>
                <p>Download and install the local service:</p>
                <CodeBlock>
                  npm install -g @block-explorer/server
                  # or
                  curl -L https://github.com/your-repo/releases/latest/download/install.sh | bash
                </CodeBlock>
              </StepContent>
            </Step>
            <Step>
              <StepNumber>2</StepNumber>
              <StepContent>
                <p>Start the service:</p>
                <CodeBlock>
                  block-explorer-server start
                  # Runs on http://localhost:3001 by default
                </CodeBlock>
              </StepContent>
            </Step>
            <Step>
              <StepNumber>3</StepNumber>
              <StepContent>
                <p>Refresh this page to auto-detect the service</p>
                <PrimaryButton onClick={() => window.location.reload()}>
                  🔄 Refresh Page
                </PrimaryButton>
              </StepContent>
            </Step>
          </InstallSteps>
          
          <DownloadLinks>
            <h4>Direct Downloads:</h4>
            <LinkGrid>
              <DownloadLink href="#" target="_blank">
                📦 npm Package
              </DownloadLink>
              <DownloadLink href="#" target="_blank">
                🐧 Linux Binary
              </DownloadLink>
              <DownloadLink href="#" target="_blank">
                🍎 macOS Binary
              </DownloadLink>
              <DownloadLink href="#" target="_blank">
                🪟 Windows Binary
              </DownloadLink>
            </LinkGrid>
          </DownloadLinks>
        </OptionSection>
        
        <Divider />
        
        <OptionSection>
          <h3>Option 2: Use Remote API Service</h3>
          <p>Connect to a remote API service (hosted by you or others).</p>
          
          <Form onSubmit={handleRemoteSubmit}>
            <InputGroup>
              <label htmlFor="remote-url">API Service URL:</label>
              <Input
                id="remote-url"
                type="url"
                placeholder="https://api.example.com"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                required
              />
            </InputGroup>
            
            <InputGroup>
              <label htmlFor="service-name">Service Name (optional):</label>
              <Input
                id="service-name"
                type="text"
                placeholder="My API Service"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
              />
            </InputGroup>
            
            <PrimaryButton type="submit" disabled={isConfiguring}>
              {isConfiguring ? '🔗 Connecting...' : '🔗 Connect to Remote Service'}
            </PrimaryButton>
          </Form>
        </OptionSection>
      </SetupCard>
    </Container>
  );
  
  async function handleRemoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsConfiguring(true);
    
    try {
      await configureRemoteService(remoteUrl, serviceName || undefined);
    } catch (err) {
      // Error is handled by the hook
    } finally {
      setIsConfiguring(false);
    }
  }
};

const LoadingScreen: React.FC = () => (
  <Container>
    <LoadingCard>
      <Spinner />
      <h2>🔍 Scanning for local services...</h2>
      <p>Checking ports 3001-3003, 8001, 8080...</p>
    </LoadingCard>
  </Container>
);

// Styled components
const Container = styled.div\`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
\`;

const SetupCard = styled.div\`
  background: white;
  border-radius: 12px;
  padding: 40px;
  max-width: 800px;
  width: 100%;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  
  h1 {
    margin: 0 0 16px 0;
    color: #1a1a1a;
    text-align: center;
  }
  
  > p {
    color: #666;
    text-align: center;
    margin-bottom: 40px;
  }
\`;

const SuccessCard = styled(SetupCard)\`
  text-align: center;
  max-width: 500px;
  
  h2 {
    color: #059669;
    margin-bottom: 24px;
  }
\`;

const LoadingCard = styled(SetupCard)\`
  text-align: center;
  max-width: 400px;
  
  h2 {
    color: #3b82f6;
    margin: 24px 0 16px 0;
  }
\`;

const ServiceInfo = styled.div\`
  background: #f8fafc;
  border-radius: 8px;
  padding: 20px;
  margin: 24px 0;
  text-align: left;
  
  p {
    margin: 8px 0;
    color: #374151;
  }
\`;

const OptionSection = styled.section\`
  margin-bottom: 40px;
  
  h3 {
    color: #1f2937;
    margin-bottom: 12px;
  }
  
  > p {
    color: #6b7280;
    margin-bottom: 20px;
  }
\`;

const InstallSteps = styled.div\`
  margin: 24px 0;
\`;

const Step = styled.div\`
  display: flex;
  margin-bottom: 24px;
  align-items: flex-start;
\`;

const StepNumber = styled.div\`
  background: #3b82f6;
  color: white;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 14px;
  margin-right: 16px;
  flex-shrink: 0;
\`;

const StepContent = styled.div\`
  flex: 1;
  
  p {
    margin: 0 0 12px 0;
    color: #374151;
  }
\`;

const CodeBlock = styled.pre\`
  background: #1f2937;
  color: #e5e7eb;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.4;
  margin: 12px 0;
\`;

const DownloadLinks = styled.div\`
  margin-top: 24px;
  
  h4 {
    margin-bottom: 12px;
    color: #374151;
  }
\`;

const LinkGrid = styled.div\`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
\`;

const DownloadLink = styled.a\`
  display: block;
  padding: 12px 16px;
  background: #f3f4f6;
  border-radius: 8px;
  text-decoration: none;
  color: #374151;
  text-align: center;
  font-weight: 500;
  transition: background 0.2s;
  
  &:hover {
    background: #e5e7eb;
  }
\`;

const Divider = styled.hr\`
  border: none;
  height: 1px;
  background: #e5e7eb;
  margin: 40px 0;
\`;

const Form = styled.form\`
  display: flex;
  flex-direction: column;
  gap: 20px;
\`;

const InputGroup = styled.div\`
  display: flex;
  flex-direction: column;
  gap: 8px;
  
  label {
    font-weight: 500;
    color: #374151;
  }
\`;

const Input = styled.input\`
  padding: 12px 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 16px;
  
  &:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
\`;

const ButtonGroup = styled.div\`
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 24px;
\`;

const Button = styled.button\`
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 16px;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
\`;

const PrimaryButton = styled(Button)\`
  background: #3b82f6;
  color: white;
  
  &:hover:not(:disabled) {
    background: #2563eb;
  }
\`;

const SecondaryButton = styled(Button)\`
  background: #f3f4f6;
  color: #374151;
  
  &:hover:not(:disabled) {
    background: #e5e7eb;
  }
\`;

const ErrorMessage = styled.div\`
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 20px;
\`;

const Spinner = styled.div\`
  width: 40px;
  height: 40px;
  border: 4px solid #e5e7eb;
  border-left: 4px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto;
  
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
\`;
```

### 5. 应用入口集成

```typescript
// src/client/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ServiceSetup } from '@/components/ServiceSetup/ServiceSetup';
import { App } from '@/App';
import { useServiceSetup } from '@/hooks/useServiceSetup';
import '@/styles/globals';

const Root: React.FC = () => {
  const { status, serviceConfig } = useServiceSetup();
  
  if (status === 'setup-required') {
    return <ServiceSetup />;
  }
  
  if (status === 'loading') {
    return <ServiceSetup />; // 显示加载状态
  }
  
  return (
    <BrowserRouter>
      <App serviceConfig={serviceConfig!} />
    </BrowserRouter>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
```

## 后端健康检查接口

```typescript
// src/server/routes/health.ts
import { Hono } from 'hono';

const health = new Hono();

health.get('/', async (c) => {
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      services: {
        database: 'healthy',
        ethereum: 'healthy',
      },
      features: {
        indexing: true,
        search: true,
        analytics: false,
      }
    }
  });
});

health.get('/features', async (c) => {
  return c.json({
    indexing: true,
    search: true,
    analytics: false,
    customEndpoints: [
      '/api/blocks',
      '/api/transactions', 
      '/api/addresses',
      '/api/search',
      '/api/stats'
    ]
  });
});

export { health as healthRouter };
```

## 安装脚本

### 一键安装脚本
```bash
#!/bin/bash
# install.sh

set -e

echo "🚀 Installing Block Explorer Server..."

# 检测操作系统
OS="$(uname -s)"
ARCH="$(uname -m)"

case $OS in
  Linux*)  OS=linux;;
  Darwin*) OS=macos;;
  CYGWIN*) OS=windows;;
  MINGW*)  OS=windows;;
  *) echo "Unsupported OS: $OS" && exit 1;;
esac

case $ARCH in
  x86_64) ARCH=x64;;
  arm64)  ARCH=arm64;;
  *) echo "Unsupported architecture: $ARCH" && exit 1;;
esac

# 下载URL
DOWNLOAD_URL="https://github.com/your-repo/releases/latest/download/block-explorer-server-${OS}-${ARCH}"

# 安装目录
INSTALL_DIR="/usr/local/bin"
if [[ "$OS" == "windows" ]]; then
  INSTALL_DIR="$HOME/bin"
fi

# 创建安装目录
mkdir -p "$INSTALL_DIR"

# 下载文件
echo "📥 Downloading from $DOWNLOAD_URL..."
curl -L "$DOWNLOAD_URL" -o "$INSTALL_DIR/block-explorer-server"

# 设置权限
chmod +x "$INSTALL_DIR/block-explorer-server"

echo "✅ Installation completed!"
echo "🎯 Run 'block-explorer-server start' to begin"

# 检查是否在PATH中
if ! command -v block-explorer-server &> /dev/null; then
  echo "⚠️  Warning: $INSTALL_DIR is not in your PATH"
  echo "   Add it with: export PATH=\"$INSTALL_DIR:\$PATH\""
fi
```

## 优势

1. **零配置启动**：用户访问页面即可使用（仅RPC功能）
2. **渐进增强**：可选择安装本地服务获得完整功能
3. **灵活部署**：支持本地、远程或混合配置
4. **用户友好**：自动检测 + 清晰的安装指导
5. **开发友好**：开发者可以快速测试不同配置

这种设计让应用既可以作为纯前端工具使用（仅RPC功能），也可以通过安装本地服务获得完整的历史数据查询能力！
