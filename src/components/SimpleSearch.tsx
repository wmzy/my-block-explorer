import React, { useState } from "react";
import { Button } from "@/components/ui/Button";

export function SimpleSearch() {
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<
    "address" | "transaction" | "block" | null
  >(null);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<any>(null);

  const detectSearchType = (input: string) => {
    if (!input) return null;

    if (input.startsWith("0x") && input.length === 42) {
      return "address";
    } else if (input.startsWith("0x") && input.length === 66) {
      return "transaction";
    } else if (/^\d+$/.test(input)) {
      return "block";
    }
    return null;
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    setSearchType(detectSearchType(value));
  };

  const handleSearch = async () => {
    if (!query || !searchType) return;

    setSearching(true);
    setSearchResult(null);

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}`
      );
      const result = await response.json();
      setSearchResult(result);
    } catch (error) {
      setSearchResult({
        error: true,
        message: error instanceof Error ? error.message : "搜索失败",
      });
    } finally {
      setSearching(false);
    }
  };

  const getSearchTypeLabel = () => {
    switch (searchType) {
      case "address":
        return "地址";
      case "transaction":
        return "交易";
      case "block":
        return "区块";
      default:
        return "未知";
    }
  };

  return (
    <div
      style={{
        background: "white",
        padding: "20px",
        borderRadius: "8px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        marginBottom: "20px",
      }}
    >
      <h2 style={{ margin: "0 0 16px 0", color: "#374151" }}>🔍 智能搜索</h2>

      <div style={{ marginBottom: "16px" }}>
        <input
          type="text"
          placeholder="输入地址、交易哈希或区块号..."
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 16px",
            border: "2px solid #e2e8f0",
            borderRadius: "8px",
            fontSize: "16px",
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = "#3b82f6";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "#e2e8f0";
          }}
        />
      </div>

      {query && (
        <div style={{ marginBottom: "16px" }}>
          {searchType ? (
            <div
              style={{
                padding: "8px 12px",
                background: "#dbeafe",
                color: "#1e40af",
                borderRadius: "6px",
                fontSize: "14px",
              }}
            >
              检测到类型: {getSearchTypeLabel()}
            </div>
          ) : (
            <div
              style={{
                padding: "8px 12px",
                background: "#fef3c7",
                color: "#92400e",
                borderRadius: "6px",
                fontSize: "14px",
              }}
            >
              请输入有效的地址、交易哈希或区块号
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <Button
          variant="primary"
          onClick={handleSearch}
          disabled={!query || !searchType || searching}
          loading={searching}
        >
          {searching ? "搜索中..." : "搜索"}
        </Button>

        <Button
          variant="secondary"
          onClick={() => {
            setQuery("");
            setSearchType(null);
            setSearchResult(null);
          }}
        >
          清除
        </Button>
      </div>

      {/* 搜索结果 */}
      {searchResult && (
        <div
          style={{
            marginTop: "16px",
            padding: "16px",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            background: searchResult.error ? "#fef2f2" : "#f8fafc",
          }}
        >
          <h3
            style={{
              margin: "0 0 12px 0",
              color: searchResult.error ? "#dc2626" : "#374151",
              fontSize: "16px",
            }}
          >
            {searchResult.error ? "搜索出错" : "搜索结果"}
          </h3>

          {searchResult.error ? (
            <p style={{ color: "#dc2626", margin: 0 }}>
              {searchResult.message}
            </p>
          ) : (
            <div>
              <div style={{ marginBottom: "12px" }}>
                <strong>查询:</strong> {searchResult.query}
                <br />
                <strong>类型:</strong> {searchResult.type}
                <br />
                <strong>时间:</strong>{" "}
                {new Date(searchResult.timestamp).toLocaleString()}
              </div>

              <div
                style={{
                  padding: "12px",
                  background: "white",
                  borderRadius: "6px",
                  marginBottom: "12px",
                }}
              >
                <p style={{ margin: "0 0 8px 0", fontWeight: "500" }}>
                  {searchResult.result.message}
                </p>

                {searchResult.result.suggestions && (
                  <ul
                    style={{
                      margin: "8px 0 0 0",
                      paddingLeft: "20px",
                      fontSize: "14px",
                      color: "#6b7280",
                    }}
                  >
                    {searchResult.result.suggestions.map(
                      (suggestion: string, index: number) => (
                        <li key={index}>{suggestion}</li>
                      )
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: "16px",
          fontSize: "14px",
          color: "#6b7280",
          lineHeight: "1.5",
        }}
      >
        <p>
          <strong>示例:</strong>
        </p>
        <div
          style={{
            fontFamily: "monospace",
            background: "#f8fafc",
            padding: "8px",
            borderRadius: "4px",
          }}
        >
          地址: 0x742d35Cc6634C0532925a3b8D489319BaAE7fe
          <br />
          交易:
          0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060
          <br />
          区块: 18000000
        </div>
      </div>
    </div>
  );
}
