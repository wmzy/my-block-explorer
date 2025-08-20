# 本地服务安装指南

## 概述

Block Explorer 采用前后端分离架构。前端部署在 Cloudflare Pages，后端可选择安装在本地以获得历史数据查询和搜索功能。

## 安装选项

### ⚡ 快速开始（仅RPC功能）

无需安装任何本地服务，直接访问 Web 应用即可使用基础功能：
- 实时区块查询
- 实时余额查询  
- Gas 价格查询
- 交易状态检查

**限制**：无历史数据搜索和统计功能

### 🔧 完整安装（推荐）

安装本地 API 服务以获得完整功能：

#### 方式1：一键安装脚本（推荐）

```bash
# Linux/macOS
curl -L https://raw.githubusercontent.com/your-repo/block-explorer/main/scripts/install.sh | bash

# 或手动下载
wget https://raw.githubusercontent.com/your-repo/block-explorer/main/scripts/install.sh
chmod +x install.sh
./install.sh
```

**Windows (PowerShell)**：
```powershell
iwr -Uri "https://raw.githubusercontent.com/your-repo/block-explorer/main/scripts/install.ps1" | iex
```

#### 方式2：npm 安装

```bash
# 全局安装
npm install -g @block-explorer/server

# 或使用 pnpm
pnpm add -g @block-explorer/server --registry=https://registry.npmmirror.com
```

#### 方式3：预编译二进制

从 [Releases 页面](https://github.com/your-repo/block-explorer/releases) 下载对应平台的二进制文件：

- **Linux x64**: `block-explorer-server-linux-x64`
- **macOS x64**: `block-explorer-server-macos-x64` 
- **macOS ARM64**: `block-explorer-server-macos-arm64`
- **Windows x64**: `block-explorer-server-windows-x64.exe`

```bash
# 下载示例（Linux）
curl -L https://github.com/your-repo/releases/latest/download/block-explorer-server-linux-x64 -o block-explorer-server
chmod +x block-explorer-server

# 运行
./block-explorer-server start
```

#### 方式4：从源码构建

```bash
# 克隆仓库
git clone https://github.com/your-repo/block-explorer.git
cd block-explorer

# 安装依赖
pnpm install --prefer-offline --registry=https://registry.npmmirror.com

# 构建
npm run build:server

# 启动
npm run start:server
```

## 配置说明

### 环境变量配置

创建 `.env` 文件或设置环境变量：

```bash
# 必需配置
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID

# 可选配置
SERVER_PORT=3001                           # 服务端口
DATABASE_PATH=./data/blockchain.duckdb     # 数据库文件路径
LOG_LEVEL=info                            # 日志级别
SYNC_BATCH_SIZE=100                       # 同步批次大小
```

### 获取 Ethereum RPC URL

#### 免费服务（推荐新手）
1. **Infura** (免费额度：10万请求/天)
   - 注册：https://infura.io/
   - 创建项目获取 Project ID
   - URL: `https://mainnet.infura.io/v3/YOUR_PROJECT_ID`

2. **Alchemy** (免费额度：3亿算力单位/月)
   - 注册：https://www.alchemy.com/
   - 创建应用获取 API Key
   - URL: `https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY`

#### 自建节点（高级用户）
- **Geth**: 全节点同步
- **Erigon**: 轻量级全节点
- **本地测试网**: Ganache, Hardhat Network

## 服务管理

### 启动服务

```bash
# 方式1：直接启动
block-explorer-server start

# 方式2：指定端口
block-explorer-server start --port 3002

# 方式3：指定配置文件
block-explorer-server start --config ./custom.env

# 方式4：后台运行
nohup block-explorer-server start > server.log 2>&1 &
```

### 服务状态

```bash
# 检查服务状态
curl http://localhost:3001/api/health

# 预期响应
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "1.0.0",
    "services": {
      "database": "healthy",
      "ethereum": "healthy"
    }
  }
}
```

### 进程管理（推荐）

#### PM2（Node.js 应用管理器）

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start "block-explorer-server start" --name block-explorer

# 查看状态
pm2 status

# 查看日志
pm2 logs block-explorer

# 重启服务
pm2 restart block-explorer

# 设置开机自启
pm2 startup
pm2 save
```

#### systemd（Linux 系统服务）

创建服务文件 `/etc/systemd/system/block-explorer.service`：

```ini
[Unit]
Description=Block Explorer Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/block-explorer
ExecStart=/usr/local/bin/block-explorer-server start
Restart=always
RestartSec=10
Environment=ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
Environment=DATABASE_PATH=/opt/block-explorer/data/blockchain.duckdb

[Install]
WantedBy=multi-user.target
```

启动服务：
```bash
sudo systemctl daemon-reload
sudo systemctl enable block-explorer
sudo systemctl start block-explorer
sudo systemctl status block-explorer
```

## 数据管理

### 数据存储

默认数据存储在 `./data/blockchain.duckdb`，包含：
- 按需索引的区块数据
- 用户查询的交易历史
- 地址索引记录
- 搜索历史

### 数据备份

```bash
# 停止服务
pm2 stop block-explorer

# 备份数据库
cp ./data/blockchain.duckdb ./backup/blockchain-$(date +%Y%m%d).duckdb

# 重启服务
pm2 start block-explorer
```

### 数据清理

```bash
# 连接数据库清理（可选）
sqlite3 ./data/blockchain.duckdb

-- 清理30天前的搜索历史
DELETE FROM search_history WHERE searched_at < datetime('now', '-30 days');

-- 清理长期未查询的地址索引
DELETE FROM indexed_addresses WHERE last_queried < datetime('now', '-90 days');
```

## 网络配置

### 防火墙设置

```bash
# Ubuntu/Debian
sudo ufw allow 3001/tcp

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload
```

### 反向代理（可选）

#### Nginx 配置

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 故障排除

### 常见问题

#### 1. 服务无法启动
```bash
# 检查端口占用
netstat -tulpn | grep 3001
lsof -i :3001

# 检查日志
tail -f server.log
pm2 logs block-explorer
```

#### 2. RPC 连接失败
```bash
# 测试 RPC 连接
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  $ETHEREUM_RPC_URL
```

#### 3. 数据库权限问题
```bash
# 检查数据目录权限
ls -la ./data/
chmod 755 ./data/
chmod 644 ./data/blockchain.duckdb
```

#### 4. 内存不足
```bash
# 检查内存使用
free -h
ps aux | grep block-explorer

# 调整数据库内存限制
export DATABASE_MEMORY_LIMIT=1GB
```

### 性能调优

#### 数据库优化
```bash
# 设置合适的内存限制
DATABASE_MEMORY_LIMIT=2GB    # 根据可用内存调整
DATABASE_THREADS=4           # CPU核心数

# 批次大小调整
SYNC_BATCH_SIZE=50          # 降低以减少内存使用
SYNC_BATCH_SIZE=200         # 提高以加快同步速度
```

#### 系统资源
```bash
# 增加文件描述符限制
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# 优化 TCP 参数
echo "net.core.somaxconn = 1024" >> /etc/sysctl.conf
sysctl -p
```

## 安全建议

1. **网络安全**
   - 只在必要时开放端口
   - 使用 HTTPS（通过反向代理）
   - 设置防火墙规则

2. **访问控制**
   - 限制 API 访问来源
   - 设置速率限制
   - 监控异常请求

3. **数据安全**
   - 定期备份数据库
   - 加密敏感配置
   - 定期更新依赖

## 更新升级

### 自动更新检查
```bash
# 检查新版本
block-explorer-server version --check

# 查看当前版本
block-explorer-server version
```

### 手动升级
```bash
# npm 安装的更新
npm update -g @block-explorer/server

# 二进制文件更新
curl -L https://github.com/your-repo/releases/latest/download/block-explorer-server-linux-x64 -o block-explorer-server-new
chmod +x block-explorer-server-new
mv block-explorer-server-new block-explorer-server

# 重启服务
pm2 restart block-explorer
```

## 社区支持

- **GitHub Issues**: https://github.com/your-repo/block-explorer/issues
- **文档**: https://docs.blockexplorer.com
- **社区讨论**: https://github.com/your-repo/block-explorer/discussions

---

安装遇到问题？查看 [故障排除指南](./TROUBLESHOOTING.md) 或在 GitHub 提交 Issue。
