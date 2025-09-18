import React, { useState, useEffect } from "react";
import { globalStyles } from "@/styles/global";

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

export function Client() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch health data on mount
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

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}`
      );
      const data = await response.json();
      setSearchResult(data);
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setLoading(false);
    }
  };

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
        <h1
          style={{
            color: "#1e293b",
            marginBottom: "30px",
            textAlign: "center",
          }}
        >
          🚀 Block Explorer
        </h1>

        {/* Health Status */}
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

        {/* Search */}
        <div
          style={{
            background: "white",
            padding: "20px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ margin: "0 0 16px 0", color: "#374151" }}>🔍 Search</h2>

          <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="输入地址、交易哈希或区块号..."
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
                Search Result
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

        {/* Development Info */}
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
            ✅ 统一开发环境已配置完成
            <br />
            ✅ API 服务正常运行
            <br />
            ✅ 前端应用成功加载
            <br />
            🎉 系统运行正常！
          </p>
        </div>
      </div>
    </div>
  );
}
