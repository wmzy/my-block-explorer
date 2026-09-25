import { describe, expect, it } from 'vitest';

import { scanAbiRisks } from '@/utils/abiRiskScan';

type FnEntry = {
  type: 'function';
  name: string;
  inputs: Array<{ type: string }>;
  stateMutability: string;
  outputs: unknown[];
};

const fn = (
  name: string,
  inputs: Array<{ type: string }> = [],
  stateMutability = 'nonpayable',
): FnEntry => ({ type: 'function', name, inputs, stateMutability, outputs: [] });

const abiJson = (...entries: unknown[]): string => JSON.stringify(entries);

const ERC20_FUNCTIONS: FnEntry[] = [
  fn('name', [], 'view'),
  fn('symbol', [], 'view'),
  fn('decimals', [], 'view'),
  fn('totalSupply', [], 'view'),
  fn('balanceOf', [{ type: 'address' }], 'view'),
  fn('transfer', [{ type: 'address' }, { type: 'uint256' }]),
  fn('approve', [{ type: 'address' }, { type: 'uint256' }]),
  fn('transferFrom', [
    { type: 'address' },
    { type: 'address' },
    { type: 'uint256' },
  ]),
  fn('allowance', [{ type: 'address' }, { type: 'address' }], 'view'),
];

describe('scanAbiRisks', () => {
  describe('null cases', () => {
    it('returns null for unparseable, empty and non-array JSON strings', () => {
      expect(scanAbiRisks('not json {{{')).toBeNull();
      expect(scanAbiRisks('[]')).toBeNull();
      expect(scanAbiRisks('')).toBeNull();
      expect(scanAbiRisks('   ')).toBeNull();
      expect(scanAbiRisks('{"a":1}')).toBeNull();
    });

    it('returns null for non-string non-array input', () => {
      expect(scanAbiRisks(undefined as unknown as string)).toBeNull();
      expect(scanAbiRisks(42 as unknown as string)).toBeNull();
    });

    it('returns null for an empty array', () => {
      expect(scanAbiRisks([])).toBeNull();
    });
  });

  describe('clean ERC-20', () => {
    it('returns an empty flag list, not null', () => {
      const flags = scanAbiRisks(abiJson(...ERC20_FUNCTIONS));
      expect(flags).toEqual([]);
    });
  });

  describe('mint and pausable', () => {
    const mintablePausable = abiJson(
      ...ERC20_FUNCTIONS,
      fn('mint', [{ type: 'address' }, { type: 'uint256' }]),
      fn('pause'),
      fn('unpause'),
    );

    it('flags exactly [mint, pausable] in that order, both warnings', () => {
      const flags = scanAbiRisks(mintablePausable);
      expect(flags?.map((flag) => flag.id)).toEqual(['mint', 'pausable']);
      expect(flags?.map((flag) => flag.severity)).toEqual(['warning', 'warning']);
      expect(flags?.[0]?.label).toBe('Mint');
      expect(flags?.[0]?.detail).toBe('Mint function present — supply can change');
      expect(flags?.[1]?.label).toBe('Pausable');
      expect(flags?.[1]?.detail).toBe('Pausable — transfers can be halted');
    });

    it('reports the canonical mint signature as evidence', () => {
      const flags = scanAbiRisks(mintablePausable);
      expect(flags?.[0]?.evidence).toEqual(['mint(address,uint256)']);
    });

    it('requires BOTH pause and unpause for the pausable flag', () => {
      const pauseOnly = scanAbiRisks(
        abiJson(...ERC20_FUNCTIONS, fn('mint', [{ type: 'address' }, { type: 'uint256' }]), fn('pause')),
      );
      expect(pauseOnly?.map((flag) => flag.id)).toEqual(['mint']);
    });
  });

  describe('blacklist', () => {
    it('flags a blacklist-only ABI as a single warning with matching evidence', () => {
      const flags = scanAbiRisks(
        abiJson(...ERC20_FUNCTIONS, fn('addToBlacklist', [{ type: 'address' }])),
      );
      expect(flags).toHaveLength(1);
      expect(flags?.[0]?.id).toBe('blacklist');
      expect(flags?.[0]?.severity).toBe('warning');
      expect(flags?.[0]?.evidence).toContain('addToBlacklist(address)');
    });
  });

  describe('overload dedup and ordering', () => {
    it('dedupes an exact duplicate mint entry', () => {
      const mint = fn('mint', [{ type: 'address' }, { type: 'uint256' }]);
      const flags = scanAbiRisks(abiJson(mint, { ...mint }));
      expect(flags?.[0]?.evidence).toEqual(['mint(address,uint256)']);
    });

    it('keeps distinct overloads as separate evidence entries in first-seen order', () => {
      const flags = scanAbiRisks(
        abiJson(
          fn('mint', [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }]),
          fn('mint', [{ type: 'address' }, { type: 'uint256' }]),
        ),
      );
      expect(flags?.[0]?.evidence).toEqual([
        'mint(address,uint256,uint256)',
        'mint(address,uint256)',
      ]);
    });
  });

  describe('ownership', () => {
    it('counts a zero-input view owner() function', () => {
      const flags = scanAbiRisks(abiJson(...ERC20_FUNCTIONS, fn('owner', [], 'view')));
      expect(flags?.map((flag) => flag.id)).toEqual(['ownership']);
      expect(flags?.[0]?.severity).toBe('info');
      expect(flags?.[0]?.evidence).toEqual(['owner()']);
    });

    it('does not count owner with inputs or without view/pure mutability', () => {
      const withInputs = scanAbiRisks(
        abiJson(...ERC20_FUNCTIONS, fn('owner', [{ type: 'uint256' }], 'view')),
      );
      expect(withInputs).toEqual([]);

      const stateChanging = scanAbiRisks(
        abiJson(...ERC20_FUNCTIONS, fn('owner', [], 'nonpayable')),
      );
      expect(stateChanging).toEqual([]);

      const noMutability = scanAbiRisks(
        abiJson(...ERC20_FUNCTIONS, {
          type: 'function',
          name: 'owner',
          inputs: [],
          outputs: [],
        }),
      );
      expect(noMutability).toEqual([]);
    });

    it('counts explicit ownership transfer functions', () => {
      const flags = scanAbiRisks(
        abiJson(...ERC20_FUNCTIONS, fn('transferOwnership', [{ type: 'address' }])),
      );
      expect(flags?.map((flag) => flag.id)).toEqual(['ownership']);
      expect(flags?.[0]?.evidence).toEqual(['transferOwnership(address)']);
    });
  });

  describe('name equality only', () => {
    it('ignores similarly-named functions outside the exact name sets', () => {
      const flags = scanAbiRisks(
        abiJson(
          ...ERC20_FUNCTIONS,
          fn('setFeeRateBps', [{ type: 'uint256' }]),
          fn('issueShares', [{ type: 'address' }, { type: 'uint256' }]),
        ),
      );
      expect(flags).toEqual([]);
    });

    it('ignores event and error entries with matching names', () => {
      const flags = scanAbiRisks(
        abiJson(
          ...ERC20_FUNCTIONS,
          {
            type: 'event',
            name: 'Pause',
            inputs: [],
            anonymous: false,
          },
          {
            type: 'event',
            name: 'Transfer',
            inputs: [
              { type: 'address', name: 'from', indexed: true },
              { type: 'address', name: 'to', indexed: true },
              { type: 'uint256', name: 'value' },
            ],
            anonymous: false,
          },
          { type: 'error', name: 'Blacklisted', inputs: [{ type: 'address' }] },
        ),
      );
      expect(flags).toEqual([]);
    });

    it('skips malformed function entries instead of throwing', () => {
      const flags = scanAbiRisks(
        abiJson(
          ...ERC20_FUNCTIONS,
          { type: 'function', inputs: [{ type: 'address' }] },
          { type: 'function', name: 'mint', inputs: 'nope' },
          { type: 'function', name: 'mint', inputs: [{ type: 'address' }, { type: 'uint256' }] },
        ),
      );
      expect(flags?.map((flag) => flag.id)).toEqual(['mint']);
      expect(flags?.[0]?.evidence).toEqual(['mint(address,uint256)']);
    });
  });

  describe('array input parity', () => {
    it('behaves identically for the same ABI passed as a parsed array', () => {
      const mintablePausable = abiJson(
        ...ERC20_FUNCTIONS,
        fn('mint', [{ type: 'address' }, { type: 'uint256' }]),
        fn('pause'),
        fn('unpause'),
      );
      const fromString = scanAbiRisks(mintablePausable);
      const fromArray = scanAbiRisks(JSON.parse(mintablePausable) as unknown[]);
      expect(fromArray).toEqual(fromString);
    });
  });
});
