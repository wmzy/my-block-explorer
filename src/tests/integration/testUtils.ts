import { Hono } from "hono";
import { serve } from "@hono/node-server";
import app from "../../api-app";

export type TestServerInfo = {
  server: any;
  baseUrl: string;
  port: number;
};

let testPort = 3001;

export async function startTestServer(): Promise<TestServerInfo> {
  // 使用随机端口避免冲突
  const port = Math.floor(Math.random() * 10000) + 10000;
  const baseUrl = `http://localhost:${port}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server startup timeout"));
    }, 10000);

    try {
      const server = serve(
        {
          fetch: app.fetch,
          port,
        },
        () => {
          clearTimeout(timeout);
          // 给服务器一点时间完全启动
          setTimeout(() => {
            resolve({
              server,
              baseUrl,
              port,
            });
          }, 100);
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

export async function stopTestServer(
  serverInfo: TestServerInfo
): Promise<void> {
  return new Promise((resolve) => {
    if (serverInfo.server && typeof serverInfo.server.close === "function") {
      serverInfo.server.close(() => {
        resolve();
      });
    } else {
      // 如果没有 close 方法，直接 resolve
      resolve();
    }
  });
}

// 辅助函数：等待服务器就绪
export async function waitForServer(
  baseUrl: string,
  maxAttempts = 10
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // 忽略连接错误，继续重试
    }

    // 等待 100ms 后重试
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Server at ${baseUrl} did not become ready after ${maxAttempts} attempts`
  );
}

// 辅助函数：创建测试用的 fetch 请求
export async function testFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  return response;
}
