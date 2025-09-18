import React from "react";
import { useApi, apiEndpoints } from "../hooks/useApi";

type HealthData = {
  status: string;
  timestamp: string;
  version: string;
  message: string;
};

type OverviewData = {
  supportedChains: number;
  indexedChains: number;
  totalBlocks: number;
  totalTransactions: number;
  chains: Array<{
    chainId: number;
    chainName: string;
    chainSymbol: string;
    isIndexed: boolean;
  }>;
  lastUpdated: string;
};

export function ApiStatus() {
  const {
    data: health,
    loading: healthLoading,
    error: healthError,
  } = useApi<HealthData>(apiEndpoints.health);
  const {
    data: overview,
    loading: overviewLoading,
    error: overviewError,
  } = useApi<OverviewData>(apiEndpoints.overview);

  return (
    <div>
      {/* API 健康状态 */}
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
          🔗 API 连接状态
        </h2>

        {healthLoading ? (
          <p style={{ color: "#6b7280" }}>正在检查 API 状态...</p>
        ) : healthError ? (
          <div style={{ color: "#ef4444" }}>
            <p>❌ API 连接失败</p>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>{healthError}</p>
          </div>
        ) : health ? (
          <div style={{ color: "#059669" }}>
            <p>✅ {health.message}</p>
            <div
              style={{ fontSize: "14px", color: "#6b7280", marginTop: "8px" }}
            >
              <p>版本: {health.version}</p>
              <p>状态: {health.status}</p>
              <p>时间: {new Date(health.timestamp).toLocaleString()}</p>
            </div>
          </div>
        ) : null}
      </div>

      {/* 系统概览 */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "8px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          marginBottom: "20px",
        }}
      >
        <h2 style={{ margin: "0 0 16px 0", color: "#374151" }}>📊 系统概览</h2>

        {overviewLoading ? (
          <p style={{ color: "#6b7280" }}>正在加载统计数据...</p>
        ) : overviewError ? (
          <div style={{ color: "#ef4444" }}>
            <p>❌ 无法加载统计数据</p>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>
              {overviewError}
            </p>
          </div>
        ) : overview ? (
          <div>
            {/* 统计卡片 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "16px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  padding: "16px",
                  background: "#f8fafc",
                  borderRadius: "6px",
                }}
              >
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: "#1e293b",
                  }}
                >
                  {overview.supportedChains}
                </div>
                <div style={{ fontSize: "14px", color: "#64748b" }}>支持链</div>
              </div>

              <div
                style={{
                  textAlign: "center",
                  padding: "16px",
                  background: "#f8fafc",
                  borderRadius: "6px",
                }}
              >
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: "#1e293b",
                  }}
                >
                  {overview.indexedChains}
                </div>
                <div style={{ fontSize: "14px", color: "#64748b" }}>已索引</div>
              </div>

              <div
                style={{
                  textAlign: "center",
                  padding: "16px",
                  background: "#f8fafc",
                  borderRadius: "6px",
                }}
              >
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: "#1e293b",
                  }}
                >
                  {overview.totalBlocks.toLocaleString()}
                </div>
                <div style={{ fontSize: "14px", color: "#64748b" }}>区块数</div>
              </div>

              <div
                style={{
                  textAlign: "center",
                  padding: "16px",
                  background: "#f8fafc",
                  borderRadius: "6px",
                }}
              >
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: "#1e293b",
                  }}
                >
                  {overview.totalTransactions.toLocaleString()}
                </div>
                <div style={{ fontSize: "14px", color: "#64748b" }}>交易数</div>
              </div>
            </div>

            {/* 链列表 */}
            <h3 style={{ margin: "0 0 12px 0", color: "#374151" }}>
              支持的区块链
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "12px",
              }}
            >
              {overview.chains.map((chain) => (
                <div
                  key={chain.chainId}
                  style={{
                    padding: "12px",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    background: "#fafafa",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "8px",
                    }}
                  >
                    <div style={{ fontWeight: "500", color: "#1e293b" }}>
                      {chain.chainName}
                    </div>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        background: chain.isIndexed ? "#dcfce7" : "#fef3c7",
                        color: chain.isIndexed ? "#166534" : "#92400e",
                      }}
                    >
                      {chain.isIndexed ? "已索引" : "未索引"}
                    </span>
                  </div>

                  <div style={{ fontSize: "14px", color: "#64748b" }}>
                    <div>ID: {chain.chainId}</div>
                    <div>代币: {chain.chainSymbol}</div>
                  </div>
                </div>
              ))}
            </div>

            <p
              style={{
                fontSize: "12px",
                color: "#6b7280",
                marginTop: "16px",
              }}
            >
              最后更新: {new Date(overview.lastUpdated).toLocaleString()}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
