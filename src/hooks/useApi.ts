import { useState, useEffect } from 'react';

// 简化的 API Hook
export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        setData(result);
      }
      catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
      finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [url]);

  return { data, loading, error };
}

// API 基础 URL
const API_BASE = '/api';

export const apiEndpoints = {
  health: `${API_BASE}/health`,
  info: `${API_BASE}`,
  overview: `${API_BASE}/stats/overview`,
};
