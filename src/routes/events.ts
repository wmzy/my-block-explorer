import { Hono } from "hono";
import { type Address } from "viem";
import { createLogger } from "../server/logger";
import { multiChainDb } from "../database/chain-database-manager";

const logger = createLogger("events-routes");
import { rpcManager } from "../services/RpcManager";
import { eventIndexingServiceManager } from "../services/EventIndexingService";
import { eventQueryServiceManager } from "../services/EventQueryService";
import { eventPerformanceOptimizerManager } from "../services/EventPerformanceOptimizer";
import {
  getChainName,
  isChainSupported,
  getSupportedChainIds,
} from "../config/chains";
import {
  getValidatedChainId,
  getValidatedAddress,
} from "../server/validation";
import { safeJsonResponse } from "../utils/serialization";
import {
  getEventSelectorFromName,
  decodeEventData,
  getContractCreationBlock,
  getEventNameFromSignature,
} from "../utils/events";

const app = new Hono();

app.get("/chains/:chainId/contracts/:address/events/statistics", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json(
      {
        error: "Unsupported chain",
        message: `Chain ID ${chainId} is not supported`,
        supportedChains: getSupportedChainIds(),
      },
      400
    );
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json(
      {
        error: "Invalid contract address",
        message:
          "Address must be a valid 42-character hexadecimal string starting with 0x",
      },
      400
    );
  }

  try {
    await multiChainDb.getChainDatabase(chainId);

    const performanceOptimizer =
      eventPerformanceOptimizerManager.getOptimizer(chainId);
    const eventQueryService = eventQueryServiceManager.getService(chainId);

    const statistics = await performanceOptimizer.executeOptimizedQuery(
      "event_statistics",
      async () => {
        try {
          const stats = await eventQueryService.getEventStatistics(
            address.toLowerCase() as Address
          );
          return {
            chainId,
            contractAddress: address.toLowerCase(),
            isIndexed: stats.totalEvents > 0,
            indexingProgress: stats.totalEvents > 0 ? 100 : 0,
            totalEvents: stats.totalEvents,
            indexedEvents: stats.totalEvents,
            eventTypes: Object.entries(stats.eventsByType ?? {}).map(
              ([name, count]) => ({ name, count })
            ),
            storageSize: stats.storageSize ?? 0,
            lastIndexedBlock: stats.lastIndexedBlock,
            lastIndexedAt: stats.lastIndexedAt,
            errors: [],
          };
        } catch {
          return {
            chainId,
            contractAddress: address.toLowerCase(),
            isIndexed: false,
            indexingProgress: 0,
            totalEvents: 0,
            indexedEvents: 0,
            eventTypes: [],
            storageSize: 0,
            lastIndexedBlock: undefined,
            lastIndexedAt: undefined,
            errors: [],
          };
        }
      }
    );

    const responseData = safeJsonResponse({
      ...statistics,
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address.toLowerCase(),
      timestamp: new Date().toISOString(),
    });

    c.header("X-Chain-Name", getChainName(chainId));
    c.header("X-Cache-Control", "public, max-age=300");

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, "Event statistics API error");
    return c.json(
      {
        error: "Failed to fetch event statistics",
        message: error instanceof Error ? error.message : "Unknown error",
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address.toLowerCase(),
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

app.get(
  "/chains/:chainId/contracts/:address/events/indexing-status",
  async (c) => {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const address = getValidatedAddress(c.req.param("address"));

    if (isNaN(chainId) || !isChainSupported(chainId)) {
      return c.json(
        {
          error: "Unsupported chain",
          message: `Chain ID ${chainId} is not supported`,
          supportedChains: getSupportedChainIds(),
        },
        400
      );
    }

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return c.json(
        {
          error: "Invalid contract address",
          message:
            "Address must be a valid 42-character hexadecimal string starting with 0x",
        },
        400
      );
    }

    try {
      const performanceOptimizer =
        eventPerformanceOptimizerManager.getOptimizer(chainId);

      const indexingStatus = await performanceOptimizer.executeOptimizedQuery(
        "event_indexing_status",
        async () => {
          const indexingService =
            eventIndexingServiceManager.getService(chainId);
          return await indexingService.getIndexingStatus(address);
        },
        `indexing_status_${chainId}_${address}`,
        {
          useCache: true,
          timeout: 5000,
        }
      );

      c.header("X-Data-Source", "database");
      c.header("X-Chain-Name", getChainName(chainId));
      c.header("Cache-Control", "public, max-age=30");

      return c.json({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address.toLowerCase(),
        isIndexed: indexingStatus.totalEventsIndexed > 0,
        indexingProgress: indexingStatus.indexingActive ? 50 : 100,
        totalEvents: indexingStatus.totalEventsIndexed,
        lastIndexedBlock:
          indexingStatus.lastIndexedBlock?.toString() ?? null,
        lastIndexedAt: indexingStatus.lastIndexedAt?.toISOString() ?? null,
        eventTypes: indexingStatus.eventSignatures ?? [],
        errors: indexingStatus.errors.map((error) => error.message),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error }, "Event indexing status API error");

      return c.json({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address.toLowerCase(),
        isIndexed: false,
        indexingProgress: 0,
        totalEvents: 0,
        lastIndexedBlock: null,
        lastIndexedAt: null,
        eventTypes: [],
        errors: [],
        timestamp: new Date().toISOString(),
      });
    }
  }
);

app.get("/chains/:chainId/contracts/:address/events", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 1000);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const cursor = c.req.query("cursor");
  const eventName = c.req.query("eventName");
  const fromBlock = c.req.query("fromBlock");
  const toBlock = c.req.query("toBlock");
  const fromTimestamp = c.req.query("fromTimestamp");
  const toTimestamp = c.req.query("toTimestamp");
  const sort = c.req.query("sort") ?? "desc";
  const sortBy = c.req.query("sortBy") ?? "block_timestamp";

  let multiSort: unknown = null;
  const multiSortParam = c.req.query("multiSort");
  if (multiSortParam) {
    try {
      multiSort = JSON.parse(multiSortParam);
    } catch (error) {
      logger.warn({ multiSortParam }, "Invalid multiSort parameter");
    }
  }

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json(
      {
        error: "Unsupported chain",
        message: `Chain ID ${chainId} is not supported`,
        supportedChains: getSupportedChainIds(),
      },
      400
    );
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json(
      {
        error: "Invalid contract address",
        message:
          "Address must be a valid 42-character hexadecimal string starting with 0x",
      },
      400
    );
  }

  const filters: Record<string, string> = {};
  if (eventName) filters.eventName = eventName;
  if (fromBlock) filters.fromBlock = fromBlock;
  if (toBlock) filters.toBlock = toBlock;
  if (fromTimestamp) filters.fromTimestamp = fromTimestamp;
  if (toTimestamp) filters.toTimestamp = toTimestamp;

  try {
    const performanceOptimizer =
      eventPerformanceOptimizerManager.getOptimizer(chainId);

    const cacheKey = `events_${chainId}_${address}_${JSON.stringify({
      limit,
      offset,
      cursor,
      eventName,
      fromBlock,
      toBlock,
      fromTimestamp,
      toTimestamp,
      sort,
      sortBy,
      multiSort,
    })}`;

    const result = await performanceOptimizer
      .executeOptimizedQuery(
        "contract_events_query",
        async () => {
          const client = await rpcManager.getClient(chainId);
          const creationBlock = await getContractCreationBlock(client, address);

          const fromBlock2 = fromBlock ? BigInt(fromBlock) : creationBlock;
          const toBlock2: bigint | "latest" = toBlock
            ? BigInt(toBlock)
            : ("latest" as const);

          logger.info({ fromBlock: fromBlock2.toString(), toBlock: String(toBlock2) }, "Fetching events from block range");

          try {
            const maxRangeSize = 10000n;
            let allLogs: Array<{
              topics: readonly string[];
              data: string;
              blockHash: string;
              logIndex: number;
              transactionHash: string;
              transactionIndex: number;
              blockNumber: bigint;
              blockTimestamp?: string;
              address: string;
            }> = [];

            if (toBlock2 === "latest") {
              const latestBlock = await client.getBlockNumber();
              let currentFrom = fromBlock2;
              const batchSize = maxRangeSize;

              logger.info({ latestBlock: latestBlock.toString(), currentFrom: currentFrom.toString() }, "Latest block, starting fetch");

              while (currentFrom < latestBlock) {
                const currentTo = currentFrom + batchSize - 1n;
                const actualTo =
                  currentTo < latestBlock ? currentTo : latestBlock;

                const batchLogs = await client.getLogs({
                  address: address as `0x${string}`,
                  fromBlock: currentFrom,
                  toBlock: actualTo,
                  ...(eventName && {
                    topics: [getEventSelectorFromName(eventName)],
                  }),
                });

                allLogs = allLogs.concat(batchLogs);
                currentFrom = actualTo + 1n;
              }
            } else {
              const rangeSize = BigInt(toBlock2) - fromBlock2 + 1n;

              if (rangeSize <= maxRangeSize) {
                allLogs = await client.getLogs({
                  address: address as `0x${string}`,
                  fromBlock: fromBlock2,
                  toBlock: toBlock2,
                  ...(eventName && {
                    topics: [getEventSelectorFromName(eventName)],
                  }),
                });
              } else {
                let currentFrom = fromBlock2;
                const batchSize = maxRangeSize;

                while (currentFrom < BigInt(toBlock2)) {
                  const currentTo = currentFrom + batchSize - 1n;
                  const actualTo =
                    currentTo < BigInt(toBlock2)
                      ? currentTo
                      : BigInt(toBlock2);

                  const batchLogs = await client.getLogs({
                    address: address as `0x${string}`,
                    fromBlock: currentFrom,
                    toBlock: actualTo,
                    ...(eventName && {
                      topics: [getEventSelectorFromName(eventName)],
                    }),
                  });

                  allLogs = allLogs.concat(batchLogs);
                  currentFrom = actualTo + 1n;
                }
              }
            }

            logger.info({ count: allLogs.length }, "Fetched total events");

            const events = allLogs.map((log) => {
              const eventSignature = log.topics[0];
              const resolvedEventName =
                getEventNameFromSignature(eventSignature);
              const decoded = decodeEventData(
                resolvedEventName,
                log.topics.slice(1),
                log.data
              );

              return {
                blockHash: log.blockHash,
                logIndex: log.logIndex,
                transactionHash: log.transactionHash,
                transactionIndex: log.transactionIndex,
                blockNumber: log.blockNumber.toString(),
                blockTimestamp:
                  log.blockTimestamp ?? new Date().toISOString(),
                contractAddress: log.address,
                eventName: resolvedEventName,
                eventSignature: eventSignature,
                topics: log.topics.slice(1),
                data: log.data,
                decoded,
                decodedAt: new Date().toISOString(),
                indexedAt: new Date().toISOString(),
              };
            });

            let filteredEvents = events;
            if (eventName) {
              filteredEvents = events.filter(
                (event) =>
                  event.eventName.toLowerCase() === eventName.toLowerCase()
              );
            }

            return {
              events: filteredEvents,
              total: filteredEvents.length,
              hasMore: filteredEvents.length >= limit,
              nextCursor:
                filteredEvents.length > 0
                  ? filteredEvents[filteredEvents.length - 1].blockTimestamp
                  : undefined,
            };
          } catch (error) {
            logger.warn({ err: error }, "Failed to fetch events from RPC");
            return {
              events: [],
              total: 0,
              hasMore: false,
              nextCursor: undefined,
            };
          }
        },
        cacheKey,
        {
          useCache: false,
          timeout: 30000,
          expectedDataSize: limit * 1000,
        }
      )
      .catch((err) => {
        logger.error(
          { err, chainId, contractAddress: address, fromBlock, toBlock, eventName },
          "Events API error details"
        );
        throw err;
      });

    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));
    c.header("Cache-Control", "public, max-age=30");

    return c.json({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address.toLowerCase(),
      events: result.events,
      total: result.total,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      filters,
      pagination: {
        limit,
        offset,
        cursor,
        sort,
        sortBy,
        multiSort,
        totalPages: Math.ceil(result.total / limit),
        currentPage: Math.floor(offset / limit) + 1,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, "Contract events API error");

    return c.json({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address.toLowerCase(),
      events: [],
      total: 0,
      hasMore: false,
      nextCursor: undefined,
      filters,
      pagination: {
        limit,
        offset,
        cursor,
        sort,
        sortBy,
        multiSort,
        totalPages: 0,
        currentPage: 1,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

app.post("/chains/:chainId/contracts/:address/events/search", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json(
      {
        error: "Unsupported chain",
        message: `Chain ID ${chainId} is not supported`,
        supportedChains: getSupportedChainIds(),
      },
      400
    );
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json(
      {
        error: "Invalid contract address",
        message:
          "Address must be a valid 42-character hexadecimal string starting with 0x",
      },
      400
    );
  }

  try {
    const body = await c.req.json();
    const {
      filters = {},
      pagination = { limit: 50, offset: 0 },
      sort = { field: "block_timestamp", direction: "desc" },
      multiSort,
      includeSuggestions = false,
    } = body;

    const limit = Math.min(Math.max(1, pagination.limit ?? 50), 1000);
    const offset = Math.max(0, pagination.offset ?? 0);

    const validSortFields = [
      "block_timestamp",
      "block_number",
      "event_name",
      "transaction_hash",
    ];
    const validSortDirections = ["asc", "desc"];
    const sortBy = validSortFields.includes(sort.field)
      ? sort.field
      : "block_timestamp";
    const sortDirection = validSortDirections.includes(sort.direction)
      ? sort.direction
      : "desc";

    const performanceOptimizer =
      eventPerformanceOptimizerManager.getOptimizer(chainId);

    const cacheKey = `events_search_${chainId}_${address}_${JSON.stringify({
      filters,
      pagination: { limit, offset },
      sort: { sortBy, sortDirection },
      multiSort,
      includeSuggestions,
    })}`;

    const startTime = performance.now();

    const result = await performanceOptimizer.executeOptimizedQuery(
      "advanced_events_search",
      async () => {
        const searchFilters: Record<string, unknown> = {};

        if (filters.eventName) {
          searchFilters.eventName = Array.isArray(filters.eventName)
            ? filters.eventName
            : filters.eventName;
        }

        if (filters.fromBlock || filters.toBlock) {
          if (typeof filters.fromBlock === "object") {
            if (filters.fromBlock.gte)
              searchFilters.fromBlock = String(filters.fromBlock.gte);
            if (filters.fromBlock.lte)
              searchFilters.toBlock = String(filters.fromBlock.lte);
          } else {
            if (filters.fromBlock)
              searchFilters.fromBlock = String(filters.fromBlock);
            if (filters.toBlock)
              searchFilters.toBlock = String(filters.toBlock);
          }
        }

        if (filters.fromTimestamp || filters.toTimestamp) {
          if (typeof filters.fromTimestamp === "object") {
            if (filters.fromTimestamp.gte)
              searchFilters.fromTimestamp = filters.fromTimestamp.gte;
            if (filters.fromTimestamp.lte)
              searchFilters.toTimestamp = filters.fromTimestamp.lte;
          } else {
            if (filters.fromTimestamp)
              searchFilters.fromTimestamp = filters.fromTimestamp;
            if (filters.toTimestamp)
              searchFilters.toTimestamp = filters.toTimestamp;
          }
        }

        ["from", "to", "owner", "spender", "sender"].forEach((field) => {
          if (filters[field]) {
            searchFilters[field] = Array.isArray(filters[field])
              ? filters[field]
              : filters[field];
          }
        });

        if (filters.value) {
          searchFilters.value =
            typeof filters.value === "object"
              ? filters.value
              : filters.value;
        }

        if (filters.transactionHash) {
          searchFilters.transactionHash = filters.transactionHash;
        }

        ["eventName", "token"].forEach((field) => {
          if (filters[field] && typeof filters[field] === "object") {
            if (filters[field].like) {
              searchFilters[field] = filters[field];
            }
          }
        });

        let dbEvents: Array<Record<string, unknown>> = [];
        try {
          const advancedQueryService =
            eventQueryServiceManager.getService(chainId);
          const tables = await advancedQueryService.listTables();
          const contractPrefix = `events_${address.toLowerCase().slice(2, 10)}`;
          const contractTables = tables.filter((t: string) =>
            t.startsWith(contractPrefix)
          );

          for (const table of contractTables) {
            try {
              const queryResult = await advancedQueryService.queryEvents({
                tableName: table,
                filters: searchFilters,
                pagination: { limit: limit * 2 },
                sort: {
                  field: sortBy ?? "block_timestamp",
                  direction: (sortDirection as "asc" | "desc") ?? "desc",
                },
              });
              dbEvents.push(...(queryResult?.data ?? []));
            } catch {
              // Skip tables that fail to query
            }
          }
        } catch {
          dbEvents = [];
        }

        let filteredEvents = dbEvents;

        if (searchFilters.eventName) {
          if (Array.isArray(searchFilters.eventName)) {
            filteredEvents = filteredEvents.filter((event) =>
              (searchFilters.eventName as string[]).includes(
                event.eventName as string
              )
            );
          } else {
            filteredEvents = filteredEvents.filter(
              (event) => event.eventName === searchFilters.eventName
            );
          }
        }

        ["from", "to", "owner", "spender", "sender"].forEach((field) => {
          if (searchFilters[field]) {
            if (Array.isArray(searchFilters[field])) {
              filteredEvents = filteredEvents.filter((event) =>
                (searchFilters[field] as string[]).includes(
                  event[field] as string
                )
              );
            } else {
              filteredEvents = filteredEvents.filter(
                (event) => event[field] === searchFilters[field]
              );
            }
          }
        });

        if (
          searchFilters.value &&
          typeof searchFilters.value === "object" &&
          searchFilters.value !== null
        ) {
          const valueObj = searchFilters.value as Record<string, string>;
          filteredEvents = filteredEvents.filter((event) => {
            const rawValue = event.value;
            const eventValue = BigInt(
              typeof rawValue === "string" ||
                typeof rawValue === "number" ||
                typeof rawValue === "bigint"
                ? rawValue
                : String(rawValue ?? 0)
            );
            if (valueObj.gte && valueObj.lte) {
              return (
                eventValue >= BigInt(valueObj.gte) &&
                eventValue <= BigInt(valueObj.lte)
              );
            } else if (valueObj.gte) {
              return eventValue >= BigInt(valueObj.gte);
            } else if (valueObj.lte) {
              return eventValue <= BigInt(valueObj.lte);
            }
            return true;
          });
        } else if (searchFilters.value) {
          filteredEvents = filteredEvents.filter(
            (event) => event.value === searchFilters.value
          );
        }

        if (searchFilters.fromBlock || searchFilters.toBlock) {
          filteredEvents = filteredEvents.filter((event) => {
            const blockNum = Number(event.blockNumber);
            if (searchFilters.fromBlock && searchFilters.toBlock) {
              return (
                blockNum >= Number(searchFilters.fromBlock) &&
                blockNum <= Number(searchFilters.toBlock)
              );
            } else if (searchFilters.fromBlock) {
              return blockNum >= Number(searchFilters.fromBlock);
            } else if (searchFilters.toBlock) {
              return blockNum <= Number(searchFilters.toBlock);
            }
            return true;
          });
        }

        if (searchFilters.fromTimestamp || searchFilters.toTimestamp) {
          filteredEvents = filteredEvents.filter((event) => {
            const eventTime = new Date(
              String(event.blockTimestamp ?? "")
            ).getTime();
            const fromTs = searchFilters.fromTimestamp;
            const toTs = searchFilters.toTimestamp;
            if (fromTs && toTs) {
              const fromTime = new Date(String(fromTs)).getTime();
              const toTime = new Date(String(toTs)).getTime();
              return eventTime >= fromTime && eventTime <= toTime;
            } else if (fromTs) {
              const fromTime = new Date(String(fromTs)).getTime();
              return eventTime >= fromTime;
            } else if (toTs) {
              const toTime = new Date(String(toTs)).getTime();
              return eventTime <= toTime;
            }
            return true;
          });
        }

        if (searchFilters.transactionHash) {
          filteredEvents = filteredEvents.filter((event) =>
            (event.transactionHash as string)
              .toLowerCase()
              .includes(
                (searchFilters.transactionHash as string).toLowerCase()
              )
          );
        }

        ["eventName", "token"].forEach((field) => {
          if (
            searchFilters[field] &&
            typeof searchFilters[field] === "object" &&
            searchFilters[field] !== null &&
            (searchFilters[field] as Record<string, unknown>).like
          ) {
            const likeVal = (searchFilters[field] as Record<string, unknown>)
              .like as string;
            const caseInsensitive = (
              searchFilters[field] as Record<string, unknown>
            ).caseInsensitive as boolean;
            filteredEvents = filteredEvents.filter((event) => {
              const value = event[field];
              if (typeof value === "string" && caseInsensitive) {
                return value.toLowerCase().includes(likeVal.toLowerCase());
              }
              return value && String(value).includes(likeVal);
            });
          }
        });

        if (multiSort && Array.isArray(multiSort) && multiSort.length > 0) {
          const sortedMultiSort = [...multiSort].sort(
            (a, b) => (a.priority ?? 0) - (b.priority ?? 0)
          );

          filteredEvents.sort((a, b) => {
            for (const sortConfig of sortedMultiSort) {
              let aValue: number | string, bValue: number | string;

              switch (sortConfig.type) {
                case "numeric":
                  aValue = parseFloat(a[sortConfig.field]?.toString() ?? "0");
                  bValue = parseFloat(b[sortConfig.field]?.toString() ?? "0");
                  break;
                case "timestamp":
                  aValue = new Date(String(a[sortConfig.field] ?? "")).getTime();
                  bValue = new Date(String(b[sortConfig.field] ?? "")).getTime();
                  break;
                case "address":
                  aValue = a[sortConfig.field]?.toString()?.toLowerCase() ?? "";
                  bValue = b[sortConfig.field]?.toString()?.toLowerCase() ?? "";
                  break;
                case "text":
                default:
                  aValue = a[sortConfig.field]?.toString()?.toLowerCase() ?? "";
                  bValue = b[sortConfig.field]?.toString()?.toLowerCase() ?? "";
                  break;
              }

              let comparison: number;
              if (typeof aValue === "string") {
                comparison = aValue.localeCompare(bValue as string);
              } else {
                comparison = aValue - (bValue as number);
              }

              if (sortConfig.direction === "desc") {
                comparison = -comparison;
              }

              if (comparison !== 0) return comparison;
            }
            return 0;
          });
        } else {
          filteredEvents.sort((a, b) => {
            let aValue: number, bValue: number;

            switch (sortBy) {
              case "block_number":
                aValue = Number(a.blockNumber);
                bValue = Number(b.blockNumber);
                break;
              case "event_name":
                aValue = (a.eventName as string).localeCompare(
                  b.eventName as string
                );
                bValue = (b.eventName as string).localeCompare(
                  a.eventName as string
                );
                break;
              case "transaction_hash":
                aValue = (a.transactionHash as string).localeCompare(
                  b.transactionHash as string
                );
                bValue = (b.transactionHash as string).localeCompare(
                  a.transactionHash as string
                );
                break;
              case "block_timestamp":
              default:
                aValue = new Date(a.blockTimestamp as string).getTime();
                bValue = new Date(b.blockTimestamp as string).getTime();
                break;
            }

            if (sortDirection === "desc") {
              return typeof aValue === "number" ? bValue - aValue : aValue;
            }
            return typeof aValue === "number" ? aValue - bValue : bValue;
          });
        }

        const startIndex = offset;
        const endIndex = startIndex + limit;
        const paginatedEvents = filteredEvents.slice(startIndex, endIndex);

        return {
          events: paginatedEvents,
          total: filteredEvents.length,
          hasMore: endIndex < filteredEvents.length,
          pagination: {
            limit,
            offset,
            currentPage: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(filteredEvents.length / limit),
          },
        };
      },
      cacheKey,
      {
        useCache: true,
        timeout: 15000,
        expectedDataSize: limit * 1500,
      }
    );

    const executionTime = performance.now() - startTime;

    const indexesUsed: string[] = [];
    if (filters.from || filters.to) {
      indexesUsed.push("idx_from", "idx_to");
    }
    if (filters.value) indexesUsed.push("idx_value");
    if (filters.fromBlock || filters.toBlock)
      indexesUsed.push("idx_block_number");
    if (filters.fromTimestamp || filters.toTimestamp)
      indexesUsed.push("idx_block_timestamp");

    let suggestions: string[] = [];
    if (includeSuggestions && result.events.length === 0) {
      suggestions = [
        "Try removing some filters to broaden your search",
        "Check if the contract has emitted any events",
        "Verify the contract address is correct",
        "Ensure the contract supports the event types you're searching for",
      ];
    }

    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));
    c.header("Cache-Control", "public, max-age=60");
    c.header("X-Execution-Time", executionTime.toFixed(2));

    return c.json({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address.toLowerCase(),
      events: result.events,
      total: result.total,
      hasMore: result.hasMore,
      pagination: result.pagination,
      filters,
      sort: {
        field: sortBy,
        direction: sortDirection,
      },
      multiSort,
      executionTime: Math.round(executionTime * 100) / 100,
      cacheHit: executionTime < 5,
      indexesUsed,
      optimizationSuggestions:
        executionTime > 500
          ? [
              "Consider adding more specific filters",
              "Use indexed parameters when possible",
              "Reduce the time range for faster queries",
            ]
          : [],
      suggestions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, "Advanced events search API error");

    if (error instanceof SyntaxError) {
      return c.json(
        {
          error: "Invalid request body",
          message: "Request body must be valid JSON",
        },
        400
      );
    }

    return c.json(
      {
        error: "Search failed",
        message:
          error instanceof Error ? error.message : "Internal server error",
      },
      500
    );
  }
});

export default app;
