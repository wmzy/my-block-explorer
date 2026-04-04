declare module 'storage-layout-fetcher' {
  export interface Fetcher {
    explorers: Array<{
      type: string;
      client: unknown;
      key?: string;
    }>;
    solcDir: string;
    sources?: Array<{
      type: string;
      client: unknown;
    }>;
    chainId?: number;
  }

  export interface StorageLayout {
    storage: unknown[];
    types: unknown;
  }

  export function create(options?: Partial<Fetcher> & { etherscanApiKey?: string }): Fetcher;
  export function fetchStorageLayout(
    client: Fetcher,
    address: `0x${string}`,
  ): Promise<StorageLayout>;
  export function createDefaultSources(config?: {
    throttle?: unknown;
    retry?: number;
  }): Array<{ type: string; client: unknown }>;
  export function createSourcifyClient(config?: {
    baseUrl?: string;
    throttle?: unknown;
    retry?: number;
  }): { type: string; client: unknown };
  export function createBlockscanClient(config?: {
    baseUrl?: string;
    throttle?: unknown;
    retry?: number;
  }): { type: string; client: unknown };
  export function fetchContractFromSources(
    chainId: number,
    address: string,
    sources: Array<{ type: string; client: unknown }>,
  ): Promise<unknown>;
}

declare module 'evmole' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function contractInfo(bytecode: string, options?: { storage?: boolean }): any;
}
