import { rpcManager } from "./RpcManager";
import { db } from "../database/init";
import { createRetryableRpcCall } from "../utils/errorHandler";

export type ContractSource = {
  chainId: number;
  address: string;
  name?: string;
  compilerVersion?: string;
  optimizationEnabled?: boolean;
  optimizationRuns?: number;
  sourceCode: string;
  abi: string;
  constructorArguments?: string;
  verificationStatus: "verified" | "unverified" | "partial";
  verificationSource:
    | "sourcify"
    | "etherscan"
    | "mantle-explorer"
    | "manual"
    | "unknown";
  verifiedAt?: Date;
  lastChecked: Date;
};

export type ContractFile = {
  filename: string;
  content: string;
};

export class ContractSourceService {
  // 获取合约源码（优先级：数据库 -> Sourcify -> 返回未验证状态）
  async getContractSource(
    chainId: number,
    address: string
  ): Promise<ContractSource | null> {
    try {
      // 1. 先从数据库查找
      const cached = await this.getFromDatabase(chainId, address);
      if (cached && this.isCacheValid(cached)) {
        return cached;
      }

      // 2. 检查是否为合约
      const isContract = await this.isContractAddress(chainId, address);
      if (!isContract) {
        return null;
      }

      // 3. 尝试从 Sourcify 获取
      const sourcifyResult = await this.fetchFromSourcify(chainId, address);
      if (sourcifyResult) {
        await this.saveToDatabase(sourcifyResult);
        return sourcifyResult;
      }

      // 3.5. 尝试从链特定的区块浏览器获取
      const explorerResult = await this.fetchFromChainExplorer(
        chainId,
        address
      );
      if (explorerResult) {
        await this.saveToDatabase(explorerResult);
        return explorerResult;
      }

      // 4. 如果都没找到，返回未验证状态
      const unverifiedContract: ContractSource = {
        chainId,
        address: address.toLowerCase(),
        sourceCode: "",
        abi: "[]",
        verificationStatus: "unverified",
        verificationSource: "unknown",
        lastChecked: new Date(),
      };

      await this.saveToDatabase(unverifiedContract);
      return unverifiedContract;
    } catch (error) {
      console.error(`Failed to get contract source for ${address}:`, error);
      return null;
    }
  }

  // 从 Sourcify 获取合约源码
  private async fetchFromSourcify(
    chainId: number,
    address: string
  ): Promise<ContractSource | null> {
    try {
      const baseUrl = "https://sourcify.dev/server";

      // 检查合约是否在 Sourcify 中验证
      const checkUrl = `${baseUrl}/check-by-addresses?addresses=${address}&chainIds=${chainId}`;
      const checkResponse = await fetch(checkUrl);

      if (!checkResponse.ok) {
        return null;
      }

      const checkResult = await checkResponse.json();
      if (!checkResult || checkResult.length === 0) {
        return null;
      }

      const contractInfo = checkResult[0];
      if (
        contractInfo.status !== "perfect" &&
        contractInfo.status !== "partial"
      ) {
        return null;
      }

      // 获取源码文件
      const filesUrl = `${baseUrl}/files/any/${chainId}/${address}`;
      const filesResponse = await fetch(filesUrl);

      if (!filesResponse.ok) {
        return null;
      }

      const files = await filesResponse.json();

      // 查找主合约文件和 ABI
      let sourceCode = "";
      let abi = "[]";
      let contractName = "";
      let compilerVersion = "";

      // 查找 metadata.json
      const metadataFile = files.find((f: any) => f.name === "metadata.json");
      if (metadataFile) {
        try {
          const metadata = JSON.parse(metadataFile.content);
          abi = JSON.stringify(metadata.output?.abi || []);
          compilerVersion = metadata.compiler?.version || "";

          // 获取合约名称
          if (metadata.settings?.compilationTarget) {
            const target = Object.keys(metadata.settings.compilationTarget)[0];
            contractName = metadata.settings.compilationTarget[target];
          }
        } catch (e) {
          console.warn("Failed to parse metadata:", e);
        }
      }

      // 查找 Solidity 源码文件
      const solidityFiles = files.filter((f: any) => f.name.endsWith(".sol"));
      if (solidityFiles.length > 0) {
        // 如果有多个文件，合并所有源码
        if (solidityFiles.length === 1) {
          sourceCode = solidityFiles[0].content;
        } else {
          sourceCode = solidityFiles
            .map((f: any) => `// File: ${f.name}\n${f.content}`)
            .join("\n\n");
        }
      }

      return {
        chainId,
        address: address.toLowerCase(),
        name: contractName,
        compilerVersion,
        sourceCode,
        abi,
        verificationStatus:
          contractInfo.status === "perfect" ? "verified" : "partial",
        verificationSource: "sourcify",
        verifiedAt: new Date(),
        lastChecked: new Date(),
      };
    } catch (error) {
      console.error("Sourcify fetch error:", error);
      return null;
    }
  }

  // 从链特定的区块浏览器获取合约源码
  private async fetchFromChainExplorer(
    chainId: number,
    address: string
  ): Promise<ContractSource | null> {
    try {
      // 根据链ID选择对应的API
      const explorerConfig = this.getExplorerConfig(chainId);
      if (!explorerConfig) {
        return null;
      }

      const url = `${explorerConfig.apiUrl}?module=contract&action=getsourcecode&address=${address}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`Explorer API error: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.status !== "1" || !data.result || data.result.length === 0) {
        return null;
      }

      const contractData = data.result[0];

      // 检查是否有源码
      if (!contractData.SourceCode || contractData.SourceCode.trim() === "") {
        return null;
      }

      return {
        chainId,
        address: address.toLowerCase(),
        name: contractData.ContractName || "Unknown",
        compilerVersion: contractData.CompilerVersion || "Unknown",
        optimizationEnabled: contractData.OptimizationUsed === "1",
        optimizationRuns: parseInt(contractData.Runs || "200"),
        sourceCode: contractData.SourceCode,
        abi: contractData.ABI || "[]",
        constructorArguments: contractData.ConstructorArguments || "",
        verificationStatus: "verified",
        verificationSource: explorerConfig.name,
        verifiedAt: new Date(),
        lastChecked: new Date(),
      };
    } catch (error) {
      console.error("Chain explorer fetch error:", error);
      return null;
    }
  }

  // 获取链特定的区块浏览器配置
  private getExplorerConfig(
    chainId: number
  ): { name: "mantle-explorer" | "etherscan"; apiUrl: string } | null {
    const configs: Record<
      number,
      { name: "mantle-explorer" | "etherscan"; apiUrl: string }
    > = {
      5000: {
        // Mantle
        name: "mantle-explorer",
        apiUrl: "https://explorer.mantle.xyz/api",
      },
      // 可以添加更多链的配置
      // 1: { // Ethereum
      //   name: "etherscan",
      //   apiUrl: "https://api.etherscan.io/api"
      // },
    };

    return configs[chainId] || null;
  }

  // 检查地址是否为合约
  private async isContractAddress(
    chainId: number,
    address: string
  ): Promise<boolean> {
    try {
      const client = await rpcManager.getClient(chainId);
      const code = await client.getCode({ address: address as `0x${string}` });
      return Boolean(code && code !== "0x" && code.length > 2);
    } catch (error) {
      console.error("Failed to check contract address:", error);
      return false;
    }
  }

  // 从数据库获取缓存的合约信息
  private async getFromDatabase(
    chainId: number,
    address: string
  ): Promise<ContractSource | null> {
    try {
      const rows = await db.query(
        `SELECT * FROM contract_sources WHERE chain_id = ? AND address = ?`,
        [chainId, address.toLowerCase()]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];
      return {
        chainId: row.chain_id,
        address: row.address,
        name: row.name,
        compilerVersion: row.compiler_version,
        optimizationEnabled: row.optimization_enabled,
        optimizationRuns: row.optimization_runs,
        sourceCode: row.source_code,
        abi: row.abi,
        constructorArguments: row.constructor_arguments,
        verificationStatus: row.verification_status,
        verificationSource: row.verification_source,
        verifiedAt: row.verified_at ? new Date(row.verified_at) : undefined,
        lastChecked: new Date(row.last_checked),
      };
    } catch (error) {
      console.error("Database query error:", error);
      return null;
    }
  }

  // 保存到数据库
  private async saveToDatabase(contractSource: ContractSource): Promise<void> {
    try {
      await db.query(
        `
        INSERT OR REPLACE INTO contract_sources (
          chain_id, address, name, compiler_version, optimization_enabled,
          optimization_runs, source_code, abi, constructor_arguments,
          verification_status, verification_source, verified_at, last_checked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          contractSource.chainId,
          contractSource.address,
          contractSource.name,
          contractSource.compilerVersion,
          contractSource.optimizationEnabled,
          contractSource.optimizationRuns,
          contractSource.sourceCode,
          contractSource.abi,
          contractSource.constructorArguments,
          contractSource.verificationStatus,
          contractSource.verificationSource,
          contractSource.verifiedAt?.toISOString(),
          contractSource.lastChecked.toISOString(),
        ]
      );
    } catch (error) {
      console.error("Failed to save contract source:", error);
    }
  }

  // 检查缓存是否有效（24小时内）
  private isCacheValid(contractSource: ContractSource): boolean {
    const now = new Date();
    const lastChecked = contractSource.lastChecked;
    const hoursDiff =
      (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);

    // 已验证的合约缓存7天，未验证的缓存1天
    const maxHours =
      contractSource.verificationStatus === "verified" ? 24 * 7 : 24;
    return hoursDiff < maxHours;
  }

  // 解析 ABI 并提取函数信息
  async getContractFunctions(chainId: number, address: string) {
    try {
      const contractSource = await this.getContractSource(chainId, address);
      if (!contractSource || !contractSource.abi) {
        return { functions: [], events: [], errors: [] };
      }

      const abi = JSON.parse(contractSource.abi);

      const functions = abi.filter((item: any) => item.type === "function");
      const events = abi.filter((item: any) => item.type === "event");
      const errors = abi.filter((item: any) => item.type === "error");

      return {
        functions: functions.map((f: any) => ({
          name: f.name,
          type: f.stateMutability || "nonpayable",
          inputs: f.inputs || [],
          outputs: f.outputs || [],
          signature: this.generateFunctionSignature(f),
        })),
        events: events.map((e: any) => ({
          name: e.name,
          inputs: e.inputs || [],
          signature: this.generateEventSignature(e),
        })),
        errors: errors.map((e: any) => ({
          name: e.name,
          inputs: e.inputs || [],
        })),
      };
    } catch (error) {
      console.error("Failed to parse contract ABI:", error);
      return { functions: [], events: [], errors: [] };
    }
  }

  // 生成函数签名
  private generateFunctionSignature(func: any): string {
    const inputs =
      func.inputs?.map((input: any) => input.type).join(", ") || "";
    return `${func.name}(${inputs})`;
  }

  // 生成事件签名
  private generateEventSignature(event: any): string {
    const inputs =
      event.inputs?.map((input: any) => input.type).join(", ") || "";
    return `${event.name}(${inputs})`;
  }

  // 获取合约统计信息
  async getContractStats(chainId: number) {
    try {
      const rows = await db.query(
        `
        SELECT 
          verification_status,
          COUNT(*) as count
        FROM contract_sources 
        WHERE chain_id = ?
        GROUP BY verification_status
      `,
        [chainId]
      );

      const stats = {
        total: 0,
        verified: 0,
        unverified: 0,
        partial: 0,
      };

      rows.forEach((row: any) => {
        stats.total += row.count;
        if (row.verification_status === "verified") {
          stats.verified = row.count;
        } else if (row.verification_status === "unverified") {
          stats.unverified = row.count;
        } else if (row.verification_status === "partial") {
          stats.partial = row.count;
        }
      });

      return stats;
    } catch (error) {
      console.error("Failed to get contract stats:", error);
      return { total: 0, verified: 0, unverified: 0, partial: 0 };
    }
  }
}

export const contractSourceService = new ContractSourceService();
