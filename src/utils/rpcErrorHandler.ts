// RPC错误处理和用户反馈工具

export type RpcErrorDetails = {
  error: string;
  blockNumber?: number;
  contractAddress?: string;
  rpcUrl?: string;
  chainId?: number;
  suggestion: string;
  castCommand?: string;
  retryable: boolean;
  troubleshooting: string[];
};

export function analyzeRpcError(
  error: any,
  context: {
    blockNumber?: number;
    contractAddress?: string;
    rpcUrl?: string;
    chainId?: number;
  }
): RpcErrorDetails {
  const errorMessage = error.message || String(error);
  const { blockNumber, contractAddress, rpcUrl, chainId } = context;

  // 分析不同类型的RPC错误
  if (errorMessage.includes("no backends available for method")) {
    return {
      error: "RPC节点不支持此方法或历史数据查询",
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion:
        "该RPC节点可能不支持历史区块的状态查询。建议更换支持完整历史数据的RPC节点。",
      castCommand: blockNumber
        ? `cast code ${contractAddress} --block ${blockNumber} --rpc-url ${rpcUrl}`
        : `cast code ${contractAddress} --rpc-url ${rpcUrl}`,
      retryable: false,
      troubleshooting: [
        "1. 检查RPC节点是否支持历史数据查询",
        "2. 尝试使用Archive Node（归档节点）",
        "3. 联系RPC供应商确认历史数据可用性",
        "4. 考虑使用Alchemy、Infura或QuickNode等提供完整历史数据的服务",
      ],
    };
  }

  if (
    errorMessage.includes("503") ||
    errorMessage.includes("Service Unavailable")
  ) {
    return {
      error: "RPC服务暂时不可用",
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion: "RPC服务器暂时不可用，这通常是临时问题。建议稍后重试。",
      castCommand: blockNumber
        ? `cast code ${contractAddress} --block ${blockNumber} --rpc-url ${rpcUrl}`
        : `cast code ${contractAddress} --rpc-url ${rpcUrl}`,
      retryable: true,
      troubleshooting: [
        "1. 等待5-10分钟后重试",
        "2. 检查RPC供应商的状态页面",
        "3. 尝试使用备用RPC端点",
        "4. 如果问题持续，联系RPC供应商支持",
      ],
    };
  }

  if (errorMessage.includes("429") || errorMessage.includes("rate limit")) {
    return {
      error: "请求频率超过限制",
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion:
        "请求过于频繁，触发了RPC节点的速率限制。建议降低请求频率或升级RPC服务计划。",
      castCommand: blockNumber
        ? `cast code ${contractAddress} --block ${blockNumber} --rpc-url ${rpcUrl}`
        : `cast code ${contractAddress} --rpc-url ${rpcUrl}`,
      retryable: true,
      troubleshooting: [
        "1. 等待速率限制重置（通常1分钟）",
        "2. 升级到更高级别的RPC服务计划",
        "3. 使用多个RPC端点进行负载均衡",
        "4. 实施请求缓存以减少重复查询",
      ],
    };
  }

  if (errorMessage.includes("timeout") || errorMessage.includes("TIMEOUT")) {
    return {
      error: "RPC请求超时",
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion: "RPC请求超时，可能是网络问题或RPC节点响应缓慢。",
      castCommand: blockNumber
        ? `cast code ${contractAddress} --block ${blockNumber} --rpc-url ${rpcUrl}`
        : `cast code ${contractAddress} --rpc-url ${rpcUrl}`,
      retryable: true,
      troubleshooting: [
        "1. 检查网络连接",
        "2. 增加请求超时时间",
        "3. 尝试使用地理位置更近的RPC端点",
        "4. 如果查询历史数据，考虑缩小查询范围",
      ],
    };
  }

  if (
    errorMessage.includes("missing trie node") ||
    errorMessage.includes("state not available")
  ) {
    return {
      error: "历史状态数据不可用",
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion:
        "RPC节点缺少请求区块的状态数据。这通常发生在轻节点或不完整的归档节点上。",
      castCommand: blockNumber
        ? `cast code ${contractAddress} --block ${blockNumber} --rpc-url ${rpcUrl}`
        : `cast code ${contractAddress} --rpc-url ${rpcUrl}`,
      retryable: false,
      troubleshooting: [
        "1. 使用完整的Archive Node（归档节点）",
        "2. 尝试查询更近期的区块",
        "3. 联系RPC供应商确认历史数据覆盖范围",
        "4. 考虑使用专门的历史数据服务",
      ],
    };
  }

  if (
    errorMessage.includes("connection refused") ||
    errorMessage.includes("ECONNREFUSED")
  ) {
    return {
      error: "无法连接到RPC节点",
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion: "RPC节点拒绝连接，请检查URL是否正确或节点是否在线。",
      castCommand: `cast chain-id --rpc-url ${rpcUrl}`,
      retryable: true,
      troubleshooting: [
        "1. 验证RPC URL是否正确",
        "2. 检查网络防火墙设置",
        "3. 确认RPC节点是否在线",
        "4. 尝试使用不同的网络环境",
      ],
    };
  }

  // 通用错误处理
  return {
    error: errorMessage,
    blockNumber,
    contractAddress,
    rpcUrl,
    chainId,
    suggestion: "遇到了未知的RPC错误。建议检查RPC节点状态或尝试其他RPC端点。",
    castCommand: blockNumber
      ? `cast code ${contractAddress} --block ${blockNumber} --rpc-url ${rpcUrl}`
      : `cast code ${contractAddress} --rpc-url ${rpcUrl}`,
    retryable: true,
    troubleshooting: [
      "1. 检查RPC节点状态",
      "2. 验证请求参数是否正确",
      "3. 尝试使用其他RPC端点",
      "4. 联系RPC供应商技术支持",
    ],
  };
}

export function formatRpcErrorForUser(errorDetails: RpcErrorDetails): string {
  const {
    error,
    blockNumber,
    contractAddress,
    rpcUrl,
    chainId,
    suggestion,
    castCommand,
    retryable,
    troubleshooting,
  } = errorDetails;

  let message = `🚨 RPC错误详情:\n\n`;
  message += `错误: ${error}\n`;

  if (blockNumber) message += `区块: ${blockNumber}\n`;
  if (contractAddress) message += `合约: ${contractAddress}\n`;
  if (rpcUrl) message += `RPC: ${rpcUrl}\n`;
  if (chainId) message += `链ID: ${chainId}\n`;

  message += `\n💡 建议: ${suggestion}\n`;

  if (castCommand) {
    message += `\n🔧 验证命令:\n\`\`\`bash\n${castCommand}\n\`\`\`\n`;
    message += `使用此命令可以直接验证RPC节点是否正常工作。\n`;
  }

  message += `\n🔄 可重试: ${retryable ? "是" : "否"}\n`;

  message += `\n🛠️ 故障排除步骤:\n`;
  troubleshooting.forEach((step, index) => {
    message += `${step}\n`;
  });

  return message;
}

export function shouldRetryRpcError(errorDetails: RpcErrorDetails): boolean {
  return errorDetails.retryable;
}
