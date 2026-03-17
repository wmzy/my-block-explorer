import { useState, useEffect, useCallback } from "react";
import { ApiClient, apiClient } from "@/api/client";

// 默认端口范围
const DEFAULT_PORTS = [8201, 8202, 8203, 8204, 8205];
const DEFAULT_HOST = "localhost";

export type DiscoveryStatus =
  | "idle" // 未开始
  | "discovering" // 发现中
  | "found" // 找到服务
  | "not-found" // 未找到服务
  | "error"; // 发现过程出错

export type ServiceInfo = {
  host: string;
  port: number;
  url: string;
  version?: string;
  latency?: number;
};

export function useAutoDiscovery() {
  const [status, setStatus] = useState<DiscoveryStatus>("idle");
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [currentPort, setCurrentPort] = useState<number | null>(null);

  // 测试单个端口
  const testPort = useCallback(
    async (port: number, host = DEFAULT_HOST): Promise<ServiceInfo | null> => {
      const url = `http://${host}:${port}`;
      const testApiClient = new ApiClient(url, 3000);

      try {
        const startTime = Date.now();
        const health = await testApiClient.getHealth();
        const latency = Date.now() - startTime;

        if (health && health.status) {
          return {
            host,
            port,
            url,
            version: health.version,
            latency,
          };
        }
      } catch (error) {
        // 端口不可用或服务不响应
      }

      return null;
    },
    []
  );

  // 扫描端口范围
  const discover = useCallback(
    async (
      ports = DEFAULT_PORTS,
      host = DEFAULT_HOST
    ): Promise<ServiceInfo | null> => {
      setStatus("discovering");
      setError(null);
      setIsScanning(true);
      setServiceInfo(null);

      try {
        for (const port of ports) {
          setCurrentPort(port);

          const service = await testPort(port, host);
          if (service) {
            setServiceInfo(service);
            setStatus("found");
            setIsScanning(false);
            setCurrentPort(null);

            // 更新API客户端的基础URL
            apiClient.setBaseUrl(service.url);

            return service;
          }
        }

        // 没有找到任何可用服务
        setStatus("not-found");
        setIsScanning(false);
        setCurrentPort(null);
        return null;
      } catch (error) {
        setError(error instanceof Error ? error.message : "Discovery failed");
        setStatus("error");
        setIsScanning(false);
        setCurrentPort(null);
        return null;
      }
    },
    [testPort]
  );

  // 自动发现（页面加载时）
  const autoDiscover = useCallback(async () => {
    // 首先检查是否已经配置了服务URL
    const savedUrl = localStorage.getItem("block-explorer-api-url");
    if (savedUrl) {
      try {
        const testApiClient = new ApiClient(savedUrl, 3000);
        const health = await testApiClient.getHealth();

        if (health && health.status) {
          const url = new URL(savedUrl);
          const serviceInfo: ServiceInfo = {
            host: url.hostname,
            port: parseInt(url.port, 10),
            url: savedUrl,
            version: health.version,
          };

          setServiceInfo(serviceInfo);
          setStatus("found");
          apiClient.setBaseUrl(savedUrl);
          return serviceInfo;
        }
      } catch (error) {
        // 保存的URL无效，清除并继续自动发现
        localStorage.removeItem("block-explorer-api-url");
      }
    }

    // 进行自动发现
    return discover();
  }, [discover]);

  // 手动设置API URL
  const setApiUrl = useCallback(async (url: string): Promise<boolean> => {
    try {
      const testApiClient = new ApiClient(url, 5000);
      const health = await testApiClient.getHealth();

      if (health && health.status) {
        const urlObj = new URL(url);
        const serviceInfo: ServiceInfo = {
          host: urlObj.hostname,
          port:
            parseInt(urlObj.port, 10) ||
            (urlObj.protocol === "https:" ? 443 : 80),
          url,
          version: health.version,
        };

        setServiceInfo(serviceInfo);
        setStatus("found");
        setError(null);

        // 保存到本地存储
        localStorage.setItem("block-explorer-api-url", url);

        // 更新API客户端
        apiClient.setBaseUrl(url);

        return true;
      }

      return false;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid API URL");
      return false;
    }
  }, []);

  // 重置发现状态
  const reset = useCallback(() => {
    setStatus("idle");
    setServiceInfo(null);
    setError(null);
    setIsScanning(false);
    setCurrentPort(null);
    localStorage.removeItem("block-explorer-api-url");
    apiClient.setBaseUrl("");
  }, []);

  // 页面加载时自动运行发现
  useEffect(() => {
    autoDiscover();
  }, [autoDiscover]);

  return {
    status,
    serviceInfo,
    error,
    isScanning,
    currentPort,
    discover,
    autoDiscover,
    setApiUrl,
    reset,
    testPort,
  };
}
