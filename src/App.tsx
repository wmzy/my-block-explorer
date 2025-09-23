import React, { useState, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useParams,
  useNavigate,
  Navigate,
} from "react-router-dom";
import AddressPage from "./pages/AddressPage";
import BlockPage from "./pages/BlockPage";
import TransactionPage from "./pages/TransactionPage";
import ContractPage from "./pages/ContractPage";
import TopNavigation from "./components/TopNavigation";
import RpcErrorAlert from "./components/RpcErrorAlert";
import { globalStyles } from "@/styles/global";
import { getChainInfo } from "@/config/chains";
import type { RpcError } from "./types/rpc";

type HealthData = {
  status: string;
  message: string;
  version: string;
  timestamp: string;
};

type SearchResult = {
  query: string;
  type: string;
  result: {
    found: boolean;
    message: string;
    data: any;
    suggestions: string[];
  };
  timestamp: string;
};

// 主页面组件
function HomePage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();

  const currentChainId = chainId ? parseInt(chainId) : 1;
  const chainInfo = getChainInfo(currentChainId);

  const [health, setHealth] = useState<HealthData | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [rpcError, setRpcError] = useState<RpcError | null>(null);

  // 如果链不支持，重定向到以太坊主网
  useEffect(() => {
    if (!chainInfo) {
      navigate("/chain/1", { replace: true });
      return;
    }
  }, [chainInfo, navigate]);

  // 获取健康状态
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch("/api/health");
        const data = await response.json();
        setHealth(data);
      } catch (error) {
        console.error("Failed to fetch health:", error);
      }
    };

    fetchHealth();
  }, []);

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}`, { replace: true });
  };

  const handleSearch = async (query: string) => {
    setLoading(true);
    try {
      // 使用链特定的搜索API
      const response = await fetch(
        `/api/chains/${currentChainId}/search?q=${encodeURIComponent(query)}`
      );
      const data = await response.json();
      setSearchResult(data);

      // 如果搜索成功且找到结果，根据类型进行路由跳转
      if (data.found && data.data) {
        switch (data.type) {
          case "address":
            navigate(`/chain/${currentChainId}/address/${query}`);
            break;
          case "transaction":
            navigate(`/chain/${currentChainId}/tx/${query}`);
            break;
          case "block":
            navigate(`/chain/${currentChainId}/block/${query}`);
            break;
          default:
            // 保持在当前页面显示搜索结果
            break;
        }
      }
    } catch (error) {
      console.error("Search failed:", error);

      // 检查是否是RPC相关错误
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("503") ||
        errorMessage.includes("no backends available") ||
        errorMessage.includes("RPC") ||
        errorMessage.includes("connection")
      ) {
        setRpcError({
          chainId: currentChainId,
          error: errorMessage,
          suggestion: `当前链 ${chainInfo?.name || "未知链"} 的 RPC 节点可能不可用。建议配置备用的 RPC 节点以确保稳定连接。`,
        });
      }

      // 如果链特定API不存在，回退到通用搜索
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query)}`
        );
        const data = await response.json();
        setSearchResult(data);
      } catch (fallbackError) {
        console.error("Fallback search failed:", fallbackError);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!chainInfo) {
    return <div>Loading...</div>;
  }

  return (
    <div className={globalStyles}>
      {/* 顶部导航 */}
      <TopNavigation
        currentChainId={currentChainId}
        onChainChange={handleChainChange}
        onSearch={handleSearch}
        searchPlaceholder={`在 ${chainInfo.name} 上搜索地址、交易哈希或区块号...`}
      />

      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
          padding: "20px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* RPC 错误提示 */}
        {rpcError && (
          <RpcErrorAlert
            error={rpcError}
            onConfigureRpc={() => {
              setRpcError(null);
            }}
            onDismiss={() => setRpcError(null)}
          />
        )}

        {/* 当前链信息 */}
        <div
          style={{
            background: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            marginBottom: "20px",
            border: "1px solid #e2e8f0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#10b981",
              }}
            />
            <div>
              <h3 style={{ margin: 0, color: "#374151", fontSize: "16px" }}>
                {chainInfo.name}
              </h3>
              <p style={{ margin: 0, color: "#6b7280", fontSize: "14px" }}>
                Chain ID: {chainInfo.id} • {chainInfo.nativeCurrency.symbol}
              </p>
            </div>
          </div>
        </div>

        {/* API状态 */}
        <div
          style={{
            background: "white",
            padding: "20px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ margin: "0 0 16px 0", color: "#374151" }}>API Status</h2>
          {health ? (
            <div style={{ color: "#059669" }}>
              <p>
                <strong>Status:</strong> {health.status}
              </p>
              <p>
                <strong>Message:</strong> {health.message}
              </p>
              <p>
                <strong>Version:</strong> {health.version}
              </p>
              <p>
                <strong>Last Check:</strong>{" "}
                {new Date(health.timestamp).toLocaleString()}
              </p>
            </div>
          ) : (
            <p style={{ color: "#dc2626" }}>Loading API status...</p>
          )}
        </div>

        {/* 搜索结果 */}
        {searchResult && (
          <div
            style={{
              background: "white",
              padding: "20px",
              borderRadius: "8px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              marginBottom: "20px",
            }}
          >
            <h2 style={{ margin: "0 0 16px 0", color: "#374151" }}>
              🔍 搜索结果
            </h2>
            <div
              style={{
                padding: "16px",
                background: "#f8fafc",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
              }}
            >
              <h3 style={{ margin: "0 0 12px 0", color: "#374151" }}>
                Search Result on {chainInfo.name}
              </h3>
              <p>
                <strong>Query:</strong> {searchResult.query}
              </p>
              <p>
                <strong>Type:</strong> {searchResult.type}
              </p>
              <p>
                <strong>Message:</strong> {searchResult.result.message}
              </p>

              {searchResult.result.suggestions.length > 0 && (
                <div style={{ marginTop: "12px" }}>
                  <strong>Suggestions:</strong>
                  <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
                    {searchResult.result.suggestions.map(
                      (suggestion, index) => (
                        <li key={index} style={{ marginBottom: "4px" }}>
                          {suggestion}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 开发状态 */}
        <div
          style={{
            background: "#f8fafc",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <h3 style={{ margin: "0 0 12px 0", color: "#374151" }}>
            Development Status
          </h3>
          <p style={{ color: "#6b7280", lineHeight: "1.6", margin: 0 }}>
            ✅ 多链支持已配置完成
            <br />
            ✅ 链切换功能正常运行
            <br />
            ✅ URL路由集成完成
            <br />
            ✅ API 服务正常运行
            <br />
            🎉 当前链: {chainInfo.name} (Chain ID: {chainInfo.id})
          </p>
        </div>
      </div>
    </div>
  );
}

// 主应用组件
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/chain/:chainId" element={<HomePage />} />
        <Route
          path="/chain/:chainId/address/:address"
          element={<AddressPage />}
        />
        <Route
          path="/chain/:chainId/block/:blockNumber"
          element={<BlockPage />}
        />
        <Route
          path="/chain/:chainId/tx/:txHash"
          element={<TransactionPage />}
        />
        <Route
          path="/chain/:chainId/contract/:address"
          element={<ContractPage />}
        />
        <Route path="/" element={<Navigate to="/chain/1" replace />} />
        <Route path="*" element={<Navigate to="/chain/1" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
