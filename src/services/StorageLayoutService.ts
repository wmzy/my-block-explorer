import { contractInfo } from 'evmole';
import { db, storageLayouts } from '../database/init';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '../server/logger';
import { formatAddress } from '../utils/address';
import { rpcManager } from './RpcManager';
import type { Address } from 'viem';
import type {
  StorageLayout,
  StorageLayoutResponse,
  StorageMember,
  TypesMap,
} from '../types/storage';

const logger = createLogger('storage-layout-service');

const GLOBAL_TIMEOUT_MS = 20_000;
const FETCHER_TIMEOUT_MS = 8_000;

type Fetcher = {
  explorers: Array<{ type: string; client: unknown; key?: string }>;
  solcDir: string;
  sources?: Array<{ type: string; client: unknown }>;
  chainId?: number;
};

type StorageFetcherModule = {
  create: (options?: Partial<Fetcher> & { etherscanApiKey?: string }) => Fetcher;
  fetchStorageLayout: (client: Fetcher, address: `0x${string}`) => Promise<StorageLayout>;
};

let storageFetcherModule: StorageFetcherModule | null = null;

async function getStorageFetcher(): Promise<StorageFetcherModule> {
  if (!storageFetcherModule) {
    const module = await import('storage-layout-fetcher');
    storageFetcherModule = module as StorageFetcherModule;
  }
  return storageFetcherModule;
}

const FETCHER_CACHE: Record<number, Fetcher> = {};

async function getFetcherForChain(chainId: number): Promise<Fetcher> {
  if (!FETCHER_CACHE[chainId]) {
    const fetcher = await getStorageFetcher();
    FETCHER_CACHE[chainId] = fetcher.create({ chainId });
  }
  return FETCHER_CACHE[chainId];
}

export class StorageLayoutService {
  async getStorageLayout(chainId: number, address: Address): Promise<StorageLayoutResponse> {
    logger.info({ chainId, address }, 'Getting storage layout');

    const startTime = Date.now();

    try {
      const cached = await this.getFromDatabase(chainId, address);
      if (cached) {
        logger.info({ chainId, address }, 'Found cached storage layout');
        return { found: true, layout: cached.layout, source: cached.source };
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'CACHED_NOT_FOUND') {
        return { found: false, error: 'Storage layout not available for this contract' };
      }
      logger.warn({ err: error }, 'Database lookup failed, continuing with API fetch');
    }

    const fetcherPromise = this.fetchFromStorageLayoutFetcher(chainId, address);
    const fetcherTimeoutPromise = new Promise<null>(resolve =>
      setTimeout(() => resolve(null), FETCHER_TIMEOUT_MS),
    );

    try {
      const layout = await Promise.race([fetcherPromise, fetcherTimeoutPromise]);
      if (layout) {
        logger.info(
          { chainId, address, count: layout.storage.length },
          'Fetched storage layout from explorer',
        );
        await this.saveToDatabase(chainId, address, layout, 'fetcher');
        return { found: true, layout, source: 'fetcher' };
      }
    } catch (error) {
      logger.warn({ err: error, chainId, address }, 'storage-layout-fetcher failed');
    }

    if (Date.now() - startTime > GLOBAL_TIMEOUT_MS) {
      return { found: false, error: 'Request timeout' };
    }

    try {
      const layout = await this.fetchFromEvmole(chainId, address);
      if (layout) {
        logger.info(
          { chainId, address, count: layout.storage.length },
          'Fetched storage layout from evmole',
        );
        await this.saveToDatabase(chainId, address, layout, 'evmole');
        return { found: true, layout, source: 'evmole' };
      }
    } catch (error) {
      logger.warn({ err: error, chainId, address }, 'evmole fallback failed');
    }

    logger.info({ chainId, address }, 'No storage layout found from any source');
    await this.cacheNotFound(chainId, address);

    return { found: false, error: 'Storage layout not available for this contract' };
  }

  private async fetchFromStorageLayoutFetcher(
    chainId: number,
    address: Address,
  ): Promise<StorageLayout | null> {
    try {
      const fetcherModule = await getStorageFetcher();
      const fetcher = await getFetcherForChain(chainId);

      const layout = await fetcherModule.fetchStorageLayout(fetcher, address);

      if (layout && layout.storage && Array.isArray(layout.storage)) {
        return {
          storage: layout.storage as StorageMember[],
          types: layout.types as TypesMap | null,
        };
      }

      return null;
    } catch (error) {
      logger.warn({ err: error, chainId, address }, 'fetchFromStorageLayoutFetcher error');
      return null;
    }
  }

  private async fetchFromEvmole(chainId: number, address: Address): Promise<StorageLayout | null> {
    const client = await rpcManager.getClient(chainId);
    if (!client) {
      logger.warn({ chainId }, 'No RPC client for evmole');
      return null;
    }

    try {
      const bytecode = await client.getCode({ address });

      if (!bytecode || bytecode === '0x') {
        logger.warn({ chainId, address }, 'No bytecode found for evmole');
        return null;
      }

      const info = contractInfo(bytecode, { storage: true });

      if (!info.storage || info.storage.length === 0) {
        logger.warn({ chainId, address }, 'No storage layout found by evmole');
        return null;
      }

      const typesMap: TypesMap = {};
      const storage: StorageMember[] = info.storage.map(
        (record: { slot: string; offset: number; type: string }, index: number) => {
          const typeKey = record.type;
          if (!typesMap[typeKey]) {
            typesMap[typeKey] = {
              encoding: 'inplace',
              label: typeKey as any,
              numberOfBytes: '32',
            };
          }

          return {
            astId: index,
            contract: '',
            label: `var_${index}`,
            offset: record.offset,
            slot: record.slot,
            type: typeKey,
          };
        },
      );

      return { storage, types: typesMap };
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'evmole failed');
      return null;
    }
  }

  async saveToDatabase(
    chainId: number,
    address: Address,
    layout: StorageLayout,
    source: string,
  ): Promise<void> {
    try {
      const formattedAddress = formatAddress(address);

      await db
        .insert(storageLayouts)
        .values({
          chainId,
          address: formattedAddress,
          layout: JSON.stringify(layout),
          source,
          isProxy: false,
          implementationAddress: null,
        })
        .onConflictDoUpdate({
          target: [storageLayouts.chainId, storageLayouts.address],
          set: {
            layout: JSON.stringify(layout),
            source,
            updatedAt: new Date(),
          },
        });

      logger.info(
        { chainId, address: formattedAddress, source },
        'Saved storage layout to database',
      );
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'Failed to save storage layout to database');
    }
  }

  async getFromDatabase(
    chainId: number,
    address: Address,
  ): Promise<{ layout: StorageLayout; source: 'fetcher' | 'evmole' } | null> {
    const formattedAddress = formatAddress(address);

    const rows = await db
      .select()
      .from(storageLayouts)
      .where(and(eq(storageLayouts.chainId, chainId), eq(storageLayouts.address, formattedAddress)))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    if (row.layout === 'NOT_FOUND') {
      throw new Error('CACHED_NOT_FOUND');
    }

    try {
      const layout = JSON.parse(row.layout as string) as StorageLayout;
      return {
        layout,
        source: (row.source as 'fetcher' | 'evmole') ?? 'fetcher',
      };
    } catch {
      logger.error({ chainId, address }, 'Failed to parse cached storage layout');
      return null;
    }
  }

  async cacheNotFound(chainId: number, address: Address): Promise<void> {
    try {
      const formattedAddress = formatAddress(address);

      await db
        .insert(storageLayouts)
        .values({
          chainId,
          address: formattedAddress,
          layout: 'NOT_FOUND',
          source: null,
          isProxy: false,
          implementationAddress: null,
        })
        .onConflictDoUpdate({
          target: [storageLayouts.chainId, storageLayouts.address],
          set: {
            layout: 'NOT_FOUND',
            source: null,
            updatedAt: new Date(),
          },
        });

      logger.debug({ chainId, address: formattedAddress }, 'Cached "not found" entry');
    } catch (error) {
      logger.warn({ err: error, chainId, address }, 'Failed to cache "not found" entry');
    }
  }

  async clearCache(chainId: number, address: Address): Promise<void> {
    try {
      const formattedAddress = formatAddress(address);

      await db
        .delete(storageLayouts)
        .where(
          and(eq(storageLayouts.chainId, chainId), eq(storageLayouts.address, formattedAddress)),
        );

      logger.info({ chainId, address: formattedAddress }, 'Cleared storage layout cache');
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'Failed to clear storage layout cache');
    }
  }
}

export const storageLayoutService = new StorageLayoutService();
