import React from "react";
import { css } from "@linaria/core";

type Props = {
  functionName: string;
  chainId: number;
  chainName: string;
  error: string;
  onConfigureRpc: () => void;
  onRetry?: () => void;
};

const errorBoxStyles = css`
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 16px;
  margin: 16px 0;

  .error-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;

    .icon {
      font-size: 20px;
    }

    .title {
      font-weight: 600;
      color: #991b1b;
      margin: 0;
    }
  }

  .error-content {
    color: #7f1d1d;
    font-size: 14px;
    line-height: 1.5;
    margin-bottom: 16px;

    .function-name {
      font-weight: 500;
      font-family:
        "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
        "Courier New", monospace;
      background: #fed7d7;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .chain-info {
      font-weight: 500;
    }
  }

  .error-details {
    background: #fff5f5;
    border: 1px solid #fed7d7;
    border-radius: 6px;
    padding: 12px;
    margin: 12px 0;
    font-size: 13px;
    color: #7f1d1d;
    font-family:
      "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
      "Courier New", monospace;
  }

  .suggestions {
    background: #fff5f5;
    border: 1px solid #fed7d7;
    border-radius: 6px;
    padding: 12px;
    margin: 12px 0;

    .suggestion-title {
      font-weight: 600;
      color: #991b1b;
      margin: 0 0 8px 0;
      font-size: 14px;
    }

    ul {
      margin: 0;
      padding-left: 20px;
      color: #7f1d1d;
      font-size: 13px;

      li {
        margin-bottom: 4px;
      }
    }
  }

  .actions {
    display: flex;
    gap: 12px;
    margin-top: 16px;
  }
`;

const buttonStyles = css`
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;

  &.primary {
    background: #dc2626;
    color: white;

    &:hover {
      background: #b91c1c;
    }
  }

  &.secondary {
    background: white;
    color: #7f1d1d;
    border: 1px solid #fecaca;

    &:hover {
      background: #fef2f2;
    }
  }
`;

export default function RpcFunctionError({
  functionName,
  chainId,
  chainName,
  error,
  onConfigureRpc,
  onRetry,
}: Props) {
  const getSuggestions = (functionName: string) => {
    switch (functionName) {
      case "getContractCreationInfo":
        return [
          "当前RPC节点可能不支持历史状态查询",
          "建议配置支持archive模式的RPC节点",
          "可以尝试使用Alchemy、Infura等专业服务商的RPC",
          "某些免费RPC节点限制历史数据访问",
        ];
      case "getEvents":
        return [
          "当前RPC节点可能限制了事件查询的区块范围",
          "建议减小查询的区块范围或配置更强大的RPC节点",
          "某些RPC节点限制单次查询最多1000个区块",
          "可以配置支持大范围查询的RPC节点",
        ];
      case "getStorageAt":
        return [
          "当前RPC节点可能不支持存储槽查询",
          "代理合约检测需要支持eth_getStorageAt的RPC节点",
          "建议使用完整节点或专业RPC服务",
        ];
      default:
        return [
          "当前RPC节点可能存在功能限制",
          "建议配置更稳定、功能完整的RPC节点",
          "可以尝试使用多个RPC节点作为备选",
        ];
    }
  };

  const getFunctionDisplayName = (functionName: string) => {
    switch (functionName) {
      case "getContractCreationInfo":
        return "合约创建信息查询";
      case "getEvents":
        return "事件日志查询";
      case "getStorageAt":
        return "存储槽查询";
      default:
        return functionName;
    }
  };

  return (
    <div className={errorBoxStyles}>
      <div className="error-header">
        <span className="icon">⚠️</span>
        <h4 className="title">RPC 功能错误</h4>
      </div>

      <div className="error-content">
        <p>
          <span className="function-name">
            {getFunctionDisplayName(functionName)}
          </span>
          在{" "}
          <span className="chain-info">
            {chainName} (Chain ID: {chainId})
          </span>{" "}
          上执行失败。
        </p>
      </div>

      <div className="error-details">错误详情: {error}</div>

      <div className="suggestions">
        <div className="suggestion-title">💡 可能的解决方案：</div>
        <ul>
          {getSuggestions(functionName).map((suggestion, index) => (
            <li key={index}>{suggestion}</li>
          ))}
        </ul>
      </div>

      <div className="actions">
        <button className={`${buttonStyles} primary`} onClick={onConfigureRpc}>
          配置 {chainName} RPC 节点
        </button>
        {onRetry && (
          <button className={`${buttonStyles} secondary`} onClick={onRetry}>
            重试
          </button>
        )}
      </div>
    </div>
  );
}
