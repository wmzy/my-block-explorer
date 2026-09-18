import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_CHAINS,
  POPULAR_CHAINS,
  getChainInfo,
  getChainName,
  getChainSymbol,
  isChainSupported,
  getSupportedChainIds,
  isPopularChain,
  getChainType,
  getSortedChains,
  searchChains,
} from '@/config/chains';

describe('Chains Configuration', () => {
  describe('基本配置', () => {
    it('应该有支持的链列表', () => {
      expect(SUPPORTED_CHAINS).toBeDefined();
      expect(Array.isArray(SUPPORTED_CHAINS)).toBe(true);
      expect(SUPPORTED_CHAINS.length).toBeGreaterThan(0);
    });

    it('应该有热门链列表', () => {
      expect(POPULAR_CHAINS).toBeDefined();
      expect(Array.isArray(POPULAR_CHAINS)).toBe(true);
      expect(POPULAR_CHAINS.length).toBeGreaterThan(0);
    });

    it('热门链应该都在支持的链列表中', () => {
      POPULAR_CHAINS.forEach((popularChain) => {
        const isSupported = SUPPORTED_CHAINS.some(chain => chain.id === popularChain.id);
        expect(isSupported).toBe(true);
      });
    });
  });

  describe('getChainInfo', () => {
    it('应该返回有效链的信息', () => {
      const ethereumInfo = getChainInfo(1);
      expect(ethereumInfo).toBeDefined();
      expect(ethereumInfo?.id).toBe(1);
      expect(ethereumInfo?.name).toBe('Ethereum');
    });

    it('应该对无效链ID返回null', () => {
      const invalidChain = getChainInfo(999999);
      expect(invalidChain).toBeNull();
    });
  });

  describe('getChainName', () => {
    it('应该返回有效链的名称', () => {
      expect(getChainName(1)).toBe('Ethereum');
      expect(getChainName(137)).toBe('Polygon');
    });

    it('应该对无效链ID返回默认名称', () => {
      expect(getChainName(999999)).toBe('Chain 999999');
    });
  });

  describe('getChainSymbol', () => {
    it('应该返回有效链的代币符号', () => {
      expect(getChainSymbol(1)).toBe('ETH');
      expect(getChainSymbol(137)).toBe('POL'); // Polygon现在使用POL代币
    });

    it('应该对无效链ID返回默认符号', () => {
      expect(getChainSymbol(999999)).toBe('ETH'); // 实际实现返回ETH作为默认值
    });
  });

  describe('isChainSupported', () => {
    it('应该正确识别支持的链', () => {
      expect(isChainSupported(1)).toBe(true); // Ethereum
      expect(isChainSupported(137)).toBe(true); // Polygon
    });

    it('应该正确识别不支持的链', () => {
      expect(isChainSupported(999999)).toBe(false);
      expect(isChainSupported(-1)).toBe(false);
    });
  });

  describe('getSupportedChainIds', () => {
    it('应该返回所有支持的链ID数组', () => {
      const chainIds = getSupportedChainIds();
      expect(Array.isArray(chainIds)).toBe(true);
      expect(chainIds.length).toBe(SUPPORTED_CHAINS.length);
      expect(chainIds).toContain(1); // Ethereum
      expect(chainIds).toContain(137); // Polygon
    });

    it('返回的链ID应该都是数字', () => {
      const chainIds = getSupportedChainIds();
      chainIds.forEach((id) => {
        expect(typeof id).toBe('number');
        expect(id).toBeGreaterThan(0);
      });
    });
  });

  describe('isPopularChain', () => {
    it('应该正确识别热门链', () => {
      // 测试一些已知的热门链
      expect(isPopularChain(1)).toBe(true); // Ethereum
      expect(isPopularChain(137)).toBe(true); // Polygon
    });

    it('应该正确识别非热门链', () => {
      // 找一个不在热门列表中的链进行测试
      const nonPopularChainId = SUPPORTED_CHAINS.find(
        chain => !POPULAR_CHAINS.some(popular => popular.id === chain.id),
      )?.id;

      if (nonPopularChainId) {
        expect(isPopularChain(nonPopularChainId)).toBe(false);
      }
    });
  });

  describe('getChainType', () => {
    it('应该正确识别主网', () => {
      expect(getChainType(1)).toBe('mainnet'); // Ethereum
      expect(getChainType(137)).toBe('mainnet'); // Polygon
      expect(getChainType(8453)).toBe('mainnet'); // Base
    });

    it('classifies viem-flagged testnets by id: Holesky and Sepolia', () => {
      // The flag must be preferred over the hardcoded ID/name lists: these
      // two were previously misclassified as mainnets (no list entry, and
      // "holesky" was missing from the name heuristic).
      expect(getChainType(17000)).toBe('testnet'); // Holesky
      expect(getChainType(11155111)).toBe('testnet'); // Sepolia
      expect(getChainType(11155420)).toBe('testnet'); // OP Sepolia
    });

    it('derives Holesky from the testnet flag, not the name heuristic', () => {
      // Holesky's name matches none of the legacy keywords; only trusting
      // viem's flag classifies it.
      const holesky = getChainInfo(17000);
      expect(holesky?.name.toLowerCase()).not.toContain('test');
      expect(holesky?.name.toLowerCase()).not.toContain('sepolia');
      expect(getChainType(17000)).toBe('testnet');
    });

    it('treats chain 42 as LUKSO mainnet (dead Kovan id must not misclassify it)', () => {
      // The legacy hardcoded list used to call 42 a testnet (Kovan); viem
      // has since re-assigned the id to LUKSO mainnet.
      expect(getChainType(42)).toBe('mainnet');
    });

    it('returns unknown for chains absent from viem (dead testnet ids)', () => {
      // Ropsten (3) and Rinkeby (4) were removed from viem entirely.
      expect(getChainType(3)).toBe('unknown');
      expect(getChainType(4)).toBe('unknown');
      expect(getChainType(999999)).toBe('unknown');
    });

    it('应该正确识别测试网', () => {
      // 查找测试网链进行测试
      const testnetChain = SUPPORTED_CHAINS.find(chain =>
        chain.name.toLowerCase().includes('test')
        || chain.name.toLowerCase().includes('sepolia')
        || chain.name.toLowerCase().includes('goerli'),
      );

      if (testnetChain) {
        expect(getChainType(testnetChain.id)).toBe('testnet');
      }
    });
  });

  describe('getSortedChains', () => {
    it('returns every supported chain id exactly once', () => {
      const sortedChains = getSortedChains();
      expect(Array.isArray(sortedChains)).toBe(true);
      // viem's barrel exports contain alias duplicates (same chain id under
      // different exports); the sorted list must serve each id once.
      const ids = sortedChains.map(chain => chain.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(new Set(SUPPORTED_CHAINS.map(c => c.id)).size);
    });

    it('热门链应该排在前面', () => {
      const sortedChains = getSortedChains();
      const firstFewChains = sortedChains.slice(0, POPULAR_CHAINS.length);

      // 检查前几个链是否都是热门链
      firstFewChains.forEach((chain) => {
        expect(isPopularChain(chain.id)).toBe(true);
      });
    });
  });

  describe('searchChains', () => {
    it('应该能通过链ID搜索', () => {
      const results = searchChains('1');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(1);
    });

    it('应该能通过链名称搜索', () => {
      const results = searchChains('Ethereum');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(chain => chain.name.toLowerCase().includes('ethereum'))).toBe(true);
    });

    it('应该能通过代币符号搜索', () => {
      const results = searchChains('ETH');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(chain => chain.nativeCurrency.symbol === 'ETH')).toBe(true);
    });

    it('应该对空查询返回所有排序后的链', () => {
      const results = searchChains('');
      const sortedChains = getSortedChains();
      expect(results.length).toBe(sortedChains.length);
    });

    it('应该对无匹配查询返回空数组', () => {
      const results = searchChains('NonExistentChain12345');
      expect(results).toEqual([]);
    });

    it('搜索结果应该按相关性排序', () => {
      const results = searchChains('eth');

      if (results.length > 1) {
        // 精确匹配的应该排在前面
        const ethereumIndex = results.findIndex(chain => chain.id === 1);
        expect(ethereumIndex).toBeGreaterThanOrEqual(0);

        // 热门链应该优先显示
        const firstResult = results[0];
        if (firstResult.id !== 1) {
          // 如果第一个不是以太坊，那它应该是热门链或者名称以eth开头
          const isPopular = isPopularChain(firstResult.id);
          const startsWithEth = firstResult.name.toLowerCase().startsWith('eth');
          expect(isPopular || startsWithEth).toBe(true);
        }
      }
    });

    it('应该支持大小写不敏感搜索', () => {
      const lowerResults = searchChains('ethereum');
      const upperResults = searchChains('ETHEREUM');
      const mixedResults = searchChains('Ethereum');

      expect(lowerResults.length).toBeGreaterThan(0);
      expect(upperResults.length).toBe(lowerResults.length);
      expect(mixedResults.length).toBe(lowerResults.length);
    });
  });
});
