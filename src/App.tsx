import React, { useState, useEffect, useMemo } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useParams,
  useNavigate,
  Navigate,
} from "react-router-dom";
import { globalStyles } from "@/styles/global";
import {
  SUPPORTED_CHAINS,
  POPULAR_CHAINS,
  getChainInfo,
  getChainName,
  getChainType,
  isPopularChain,
  getSortedChains,
  searchChains,
} from "@/config/chains";

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

// 链选择器组件
function ChainSelector({
  currentChainId,
  onChainChange,
}: {
  currentChainId: number;
  onChainChange: (chainId: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // 当下拉菜单关闭时重置搜索
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm("");
    }
  }, [isOpen]);

  const filteredChains = useMemo(() => {
    return searchTerm ? searchChains(searchTerm) : getSortedChains();
  }, [searchTerm]);

  const currentChain = getChainInfo(currentChainId);

  // 处理下拉菜单外部点击关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (isOpen && !target.closest("[data-chain-selector]")) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div style={{ position: "relative" }} data-chain-selector>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          background: "white",
          border: "1px solid #d1d5db",
          borderRadius: "6px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: "500",
          minWidth: "200px",
        }}
      >
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontWeight: "500" }}>
            {currentChain?.name || `Chain ${currentChainId}`}
          </div>
          <div style={{ fontSize: "12px", color: "#6b7280" }}>
            ID: {currentChainId} • {currentChain?.nativeCurrency.symbol}
            {isPopularChain(currentChainId) && " ⭐"}
          </div>
        </div>
        <span
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "4px",
            background: "white",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
            zIndex: 1000,
            minWidth: "320px",
            maxHeight: "400px",
            overflow: "hidden",
          }}
        >
          {/* 搜索框 */}
          <div style={{ padding: "12px", borderBottom: "1px solid #f3f4f6" }}>
            <input
              type="text"
              placeholder="搜索链名称、ID 或代币符号..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsOpen(false);
                } else if (e.key === "Enter" && filteredChains.length > 0) {
                  // 按回车选择第一个结果
                  onChainChange(filteredChains[0].id);
                  setIsOpen(false);
                }
              }}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: "4px",
                fontSize: "14px",
                outline: "none",
              }}
              autoFocus
            />
            {searchTerm && (
              <div
                style={{
                  fontSize: "12px",
                  color: "#6b7280",
                  marginTop: "8px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>找到 {filteredChains.length} 条链</span>
                {filteredChains.length > 0 && (
                  <span style={{ color: "#9ca3af" }}>回车选择第一个</span>
                )}
              </div>
            )}
          </div>

          {/* 链列表 */}
          <div
            key={`chain-list-${searchTerm}-${filteredChains.length}`}
            style={{ maxHeight: "300px", overflowY: "auto" }}
          >
            {filteredChains.length === 0 ? (
              <div
                style={{
                  padding: "20px",
                  textAlign: "center",
                  color: "#6b7280",
                }}
              >
                未找到匹配的链
              </div>
            ) : (
              filteredChains.map((chain) => {
                const chainType = getChainType(chain.id);
                const isPopular = isPopularChain(chain.id);

                return (
                  <button
                    key={chain.id}
                    onClick={() => {
                      onChainChange(chain.id);
                      setIsOpen(false);
                      setSearchTerm("");
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "12px 16px",
                      textAlign: "left",
                      border: "none",
                      background:
                        currentChainId === chain.id ? "#eff6ff" : "transparent",
                      cursor: "pointer",
                      fontSize: "14px",
                      borderBottom: "1px solid #f9fafb",
                    }}
                    onMouseEnter={(e) => {
                      if (currentChainId !== chain.id) {
                        e.currentTarget.style.background = "#f9fafb";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (currentChainId !== chain.id) {
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: "500",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          {chain.name}
                          {isPopular && (
                            <span style={{ fontSize: "12px" }}>⭐</span>
                          )}
                          {chainType === "testnet" && (
                            <span
                              style={{
                                fontSize: "10px",
                                background: "#fef3c7",
                                color: "#92400e",
                                padding: "2px 6px",
                                borderRadius: "12px",
                              }}
                            >
                              测试网
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "12px", color: "#6b7280" }}>
                          ID: {chain.id} • {chain.nativeCurrency.symbol}
                        </div>
                      </div>
                      {currentChainId === chain.id && (
                        <span style={{ color: "#3b82f6", fontSize: "16px" }}>
                          ✓
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 主页面组件
function HomePage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();

  const currentChainId = chainId ? parseInt(chainId) : 1;
  const chainInfo = getChainInfo(currentChainId);

  const [health, setHealth] = useState<HealthData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

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

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    try {
      // 使用链特定的搜索API
      const response = await fetch(
        `/api/chains/${currentChainId}/search?q=${encodeURIComponent(searchQuery)}`
      );
      const data = await response.json();
      setSearchResult(data);
    } catch (error) {
      console.error("Search failed:", error);
      // 如果链特定API不存在，回退到通用搜索
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(searchQuery)}`
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
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
          padding: "20px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* 头部 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "30px",
          }}
        >
          <h1
            style={{
              color: "#1e293b",
              margin: 0,
              fontSize: "28px",
            }}
          >
            🚀 Block Explorer
          </h1>
          <ChainSelector
            currentChainId={currentChainId}
            onChainChange={handleChainChange}
          />
        </div>

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

        {/* 搜索 */}
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
            🔍 Search on {chainInfo.name}
          </h2>

          <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`在 ${chainInfo.name} 上搜索地址、交易哈希或区块号...`}
              style={{
                flex: 1,
                padding: "12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "16px",
                outline: "none",
              }}
              onKeyPress={(e) => e.key === "Enter" && handleSearch()}
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              style={{
                padding: "12px 24px",
                background: loading ? "#9ca3af" : "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: "16px",
              }}
            >
              {loading ? "搜索中..." : "搜索"}
            </button>
          </div>

          {searchResult && (
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
          )}
        </div>

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
        <Route path="/" element={<Navigate to="/chain/1" replace />} />
        <Route path="*" element={<Navigate to="/chain/1" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
