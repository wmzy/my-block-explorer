import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import RpcConfig from "./RpcConfig";
import {
  SUPPORTED_CHAINS,
  getChainInfo,
  getSortedChains,
  searchChains,
  isPopularChain,
  getChainType,
} from "@/config/chains";

type TopNavigationProps = {
  currentChainId: number;
  onChainChange: (chainId: number) => void;
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
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
          minWidth: "180px",
          height: "40px",
        }}
      >
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontWeight: "500", fontSize: "13px" }}>
            {currentChain?.name || `Chain ${currentChainId}`}
          </div>
          <div style={{ fontSize: "11px", color: "#6b7280" }}>
            ID: {currentChainId} • {currentChain?.nativeCurrency.symbol}
            {isPopularChain(currentChainId) && " ⭐"}
          </div>
        </div>
        <span
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            fontSize: "12px",
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

type SearchHistoryItem = {
  query: string;
  searchType?: string;
  searchedAt: string;
};

export default function TopNavigation({
  currentChainId,
  onChainChange,
  onSearch,
  searchPlaceholder,
}: TopNavigationProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [showRpcConfig, setShowRpcConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const searchContainerRef = React.useRef<HTMLDivElement>(null);

  const chainInfo = getChainInfo(currentChainId);

  const fetchSearchHistory = React.useCallback(async () => {
    try {
      const response = await fetch("/api/search/history?limit=50");
      if (!response.ok) return;
      const data = await response.json();
      setSearchHistory(data.history ?? []);
      setHistoryLoaded(true);
    } catch {
      // silently fail
    }
  }, []);

  const handleSearchFocus = () => {
    setShowHistory(true);
    if (!historyLoaded) fetchSearchHistory();
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showHistory && searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showHistory]);

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return searchHistory;
    return searchHistory.filter((item) => item.query.toLowerCase().includes(q));
  }, [searchQuery, searchHistory]);

  const selectHistoryItem = (query: string) => {
    setSearchQuery(query);
    setShowHistory(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    try {
      if (onSearch) {
        // 如果提供了自定义搜索处理函数，使用它
        await onSearch(searchQuery.trim());
      } else {
        // 默认搜索逻辑：尝试路由跳转
        const query = searchQuery.trim();

        // 简单的格式检测
        if (query.startsWith("0x") && query.length === 42) {
          // 地址格式
          navigate(`/chain/${currentChainId}/address/${query}`);
        } else if (query.startsWith("0x") && query.length === 66) {
          // 交易哈希格式
          navigate(`/chain/${currentChainId}/tx/${query}`);
        } else if (/^\d+$/.test(query)) {
          // 数字，可能是区块号
          navigate(`/chain/${currentChainId}/block/${query}`);
        } else {
          // 其他情况，使用搜索API
          const response = await fetch(
            `/api/chains/${currentChainId}/search?q=${encodeURIComponent(query)}`
          );
          const data = await response.json();

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
                // 如果没有明确的类型，保持在当前页面
                break;
            }
          }
        }
      }
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setLoading(false);
      setShowHistory(false);
      setHistoryLoaded(false);
    }
  };

  return (
    <>
      <nav
        style={{
          background: "white",
          borderBottom: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "0 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "60px",
          }}
        >
          {/* Logo */}
          <div
            onClick={() => navigate(`/chain/${currentChainId}`)}
            style={{
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "24px" }}>🚀</span>
            <span
              style={{
                fontSize: "18px",
                fontWeight: "600",
                color: "#1e293b",
              }}
            >
              Block Explorer
            </span>
          </div>

          {/* 搜索框 */}
          <div
            ref={searchContainerRef}
            style={{
              flex: 1,
              maxWidth: "400px",
              margin: "0 20px",
              position: "relative",
            }}
          >
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={handleSearchFocus}
                placeholder={
                  searchPlaceholder ||
                  `在 ${chainInfo?.name || "当前链"} 上搜索地址、交易、区块...`
                }
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "14px",
                  outline: "none",
                  height: "40px",
                  boxSizing: "border-box",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                  if (e.key === "Escape") setShowHistory(false);
                }}
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                style={{
                  padding: "8px 16px",
                  background: loading ? "#9ca3af" : "#3b82f6",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                  height: "40px",
                }}
              >
                {loading ? "搜索中..." : "搜索"}
              </button>
            </div>

            {showHistory && filteredHistory.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: "4px",
                  background: "white",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                  zIndex: 1000,
                  maxHeight: "360px",
                  overflowY: "auto",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: "11px",
                    color: "#9ca3af",
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderBottom: "1px solid #f3f4f6",
                  }}
                >
                  最近搜索
                </div>
                {filteredHistory.map((item, idx) => (
                  <button
                    key={`${item.query}-${idx}`}
                    onClick={() => selectHistoryItem(item.query)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "8px 12px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "13px",
                      color: "#374151",
                      textAlign: "left",
                      borderBottom: "1px solid #f9fafb",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#f3f4f6";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span style={{ color: "#9ca3af", fontSize: "14px" }}>🔍</span>
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: /^0x/.test(item.query)
                          ? '"SF Mono", Monaco, "Cascadia Code", monospace'
                          : "inherit",
                      }}
                    >
                      {item.query}
                    </span>
                    {item.searchType && (
                      <span
                        style={{
                          fontSize: "10px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "#f3f4f6",
                          color: "#6b7280",
                          flexShrink: 0,
                        }}
                      >
                        {item.searchType}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 右侧控制区 */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* RPC配置按钮 */}
            <button
              onClick={() => setShowRpcConfig(true)}
              style={{
                background: "white",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: "14px",
                color: "#374151",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.2s",
                height: "40px",
                fontWeight: "500",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f9fafb";
                e.currentTarget.style.borderColor = "#9ca3af";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "white";
                e.currentTarget.style.borderColor = "#d1d5db";
              }}
              title="RPC 节点配置"
            >
              ⚙️ RPC
            </button>

            {/* 链选择器 */}
            <ChainSelector
              currentChainId={currentChainId}
              onChainChange={onChainChange}
            />
          </div>
        </div>
      </nav>

      {/* RPC 配置弹窗 */}
      <RpcConfig
        isOpen={showRpcConfig}
        onClose={() => setShowRpcConfig(false)}
        chainId={currentChainId}
      />
    </>
  );
}
