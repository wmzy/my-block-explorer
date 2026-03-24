import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export const useOverviewStats = () =>
  useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => apiClient.getOverviewStats(),
    refetchInterval: 30_000,
  });

export const useLatestBlock = (chainId: number) =>
  useQuery({
    queryKey: ['blocks', 'latest', chainId],
    queryFn: () => apiClient.getLatestBlock(chainId),
    refetchInterval: 15_000,
    enabled: chainId > 0,
  });

export const useBlock = (chainId: number, blockNumber: number) =>
  useQuery({
    queryKey: ['blocks', chainId, blockNumber],
    queryFn: () => apiClient.getBlockByNumber(chainId, blockNumber),
    enabled: chainId > 0 && blockNumber >= 0,
  });

export const useBlocks = (chainId: number, limit: number, offset: number) =>
  useQuery({
    queryKey: ['blocks', 'list', chainId, limit, offset],
    queryFn: () => apiClient.getBlocks(chainId, limit, offset),
    enabled: chainId > 0,
  });

export const useTransaction = (chainId: number, txHash: string) =>
  useQuery({
    queryKey: ['transactions', chainId, txHash],
    queryFn: () => apiClient.getTransactionByHash(chainId, txHash),
    enabled: chainId > 0 && txHash.length > 0,
  });

export const useTransactions = (chainId: number, limit: number) =>
  useQuery({
    queryKey: ['transactions', 'list', chainId, limit],
    queryFn: () => apiClient.getTransactions(chainId, limit),
    enabled: chainId > 0,
  });

export const useAddressInfo = (chainId: number, address: string) =>
  useQuery({
    queryKey: ['addresses', chainId, address],
    queryFn: () => apiClient.getAddressInfo(chainId, address),
    enabled: chainId > 0 && address.length > 0,
  });

export const useAddressTransactions = (
  chainId: number,
  address: string,
  limit: number,
  offset: number,
) =>
  useQuery({
    queryKey: ['addresses', 'transactions', chainId, address, limit, offset],
    queryFn: () => apiClient.getAddressTransactions(chainId, address, limit, offset),
    enabled: chainId > 0 && address.length > 0,
  });

export const useSearch = (query: string, enabled = true) =>
  useQuery({
    queryKey: ['search', query],
    queryFn: () => apiClient.search(query),
    enabled: enabled && query.length > 0,
  });

export const useChainSearch = (chainId: number, query: string, enabled = true) =>
  useQuery({
    queryKey: ['search', chainId, query],
    queryFn: () => apiClient.searchInChain(chainId, query),
    enabled: enabled && chainId > 0 && query.length > 0,
  });

export const useContractSource = (chainId: number, address: string) =>
  useQuery({
    queryKey: ['contracts', 'source', chainId, address],
    queryFn: () => apiClient.getContractSource(chainId, address),
    enabled: chainId > 0 && address.length > 0,
  });

export const useContractAbi = (chainId: number, address: string) =>
  useQuery({
    queryKey: ['contracts', 'abi', chainId, address],
    queryFn: () => apiClient.getContractAbi(chainId, address),
    enabled: chainId > 0 && address.length > 0,
  });

export const useContractCreation = (chainId: number, address: string) =>
  useQuery({
    queryKey: ['contracts', 'creation', chainId, address],
    queryFn: () => apiClient.getContractCreation(chainId, address),
    enabled: chainId > 0 && address.length > 0,
  });

export const useStorageLayout = (chainId: number, address: string) =>
  useQuery({
    queryKey: ['contracts', 'storage-layout', chainId, address],
    queryFn: () => apiClient.getStorageLayout(chainId, address),
    enabled: chainId > 0 && address.length > 0,
    staleTime: Infinity,
  });

export const useHealth = () =>
  useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.getHealth(),
    staleTime: 60_000,
  });
