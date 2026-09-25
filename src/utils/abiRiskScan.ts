/**
 * Static vocabulary scan over a verified contract ABI — honesty contract: a
 * matching signature proves the function exists in the ABI, not that it is
 * reachable or attacker-controlled; this is a name heuristic, not an audit.
 */

export type AbiRiskFlagId =
  | 'mint'
  | 'pausable'
  | 'blacklist'
  | 'upgradeable'
  | 'ownership'
  | 'fee-controls';

export type AbiRiskFlag = {
  id: AbiRiskFlagId;
  label: string;
  severity: 'warning' | 'info';
  detail: string;
  /** Matching canonical signatures, e.g. 'mint(address,uint256)'. Deduped. */
  evidence: string[];
};

type AbiFunction = {
  name: string;
  /** Canonical signature 'name(type,type)'. */
  signature: string;
  /** Whether the raw inputs array was empty. */
  zeroInputs: boolean;
  /** stateMutability when present as a string, else null. */
  stateMutability: string | null;
};

const MINT_NAMES = new Set(['mint', 'mintTo', 'issue', '_mint', 'safeMint']);

const BLACKLIST_NAMES = new Set([
  'blacklist',
  'addToBlacklist',
  'setBlacklist',
  'setBlacklisted',
  'removeFromBlacklist',
]);

const UPGRADEABLE_NAMES = new Set(['upgradeTo', 'upgradeToAndCall']);

const OWNERSHIP_NAMES = new Set([
  'transferOwnership',
  'claimOwnership',
  'acceptOwnership',
  'renounceOwnership',
]);

const FEE_NAMES = new Set(['setFee', 'setFees', 'setFeeRate']);

/** Fixed output order plus the exact label/severity/detail copy per flag. */
const FLAG_COPY: ReadonlyArray<{
  id: AbiRiskFlagId;
  label: string;
  severity: 'warning' | 'info';
  detail: string;
}> = [
  {
    id: 'mint',
    label: 'Mint',
    severity: 'warning',
    detail: 'Mint function present — supply can change',
  },
  {
    id: 'pausable',
    label: 'Pausable',
    severity: 'warning',
    detail: 'Pausable — transfers can be halted',
  },
  {
    id: 'blacklist',
    label: 'Blacklist',
    severity: 'warning',
    detail: 'Blacklist function present — addresses can be blocked',
  },
  {
    id: 'upgradeable',
    label: 'Upgradeable',
    severity: 'info',
    detail: 'Upgrade function present — logic can be replaced',
  },
  {
    id: 'ownership',
    label: 'Ownership controls',
    severity: 'info',
    detail: 'Ownership functions present — privileged roles exist',
  },
  {
    id: 'fee-controls',
    label: 'Fee controls',
    severity: 'info',
    detail: 'Fee-setting function present — fees can change',
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Normalize a raw ABI entry into a matched-function candidate, or null. */
function normalizeFunction(entry: unknown): AbiFunction | null {
  if (!isRecord(entry)) return null;
  if (entry.type !== 'function') return null;
  const { name, inputs, stateMutability } = entry;
  if (typeof name !== 'string') return null;
  if (!Array.isArray(inputs)) return null;
  const inputTypes: string[] = [];
  for (const input of inputs) {
    if (isRecord(input) && typeof input.type === 'string') {
      inputTypes.push(input.type);
    }
  }
  return {
    name,
    signature: `${name}(${inputTypes.join(',')})`,
    zeroInputs: inputs.length === 0,
    stateMutability: typeof stateMutability === 'string' ? stateMutability : null,
  };
}

/** Deduped matching signatures in first-seen order. */
function collectEvidence(
  functions: ReadonlyArray<AbiFunction>,
  matches: (fn: AbiFunction) => boolean,
): string[] {
  const seen = new Set<string>();
  const evidence: string[] = [];
  for (const fn of functions) {
    if (!matches(fn)) continue;
    if (!seen.has(fn.signature)) {
      seen.add(fn.signature);
      evidence.push(fn.signature);
    }
  }
  return evidence;
}

const hasName = (functions: ReadonlyArray<AbiFunction>, name: string): boolean =>
  functions.some((fn) => fn.name === name);

/**
 * Statically scan a contract ABI for risk-relevant function names. Accepts a
 * JSON string or an already-parsed array; returns null for missing, empty or
 * unparseable input (never throws) and otherwise the matched flags in fixed
 * id order.
 */
export function scanAbiRisks(abi: string | unknown[]): AbiRiskFlag[] | null {
  let entries: unknown[];
  if (typeof abi === 'string') {
    if (abi.trim().length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(abi);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    entries = parsed;
  } else if (Array.isArray(abi)) {
    entries = abi;
  } else {
    return null;
  }
  if (entries.length === 0) return null;

  const functions: AbiFunction[] = [];
  for (const entry of entries) {
    const fn = normalizeFunction(entry);
    if (fn !== null) functions.push(fn);
  }

  const isPausablePair = (fn: AbiFunction): boolean =>
    fn.name === 'pause' || fn.name === 'unpause';
  const isOwnership = (fn: AbiFunction): boolean =>
    OWNERSHIP_NAMES.has(fn.name) ||
    (fn.name === 'owner' &&
      fn.zeroInputs &&
      (fn.stateMutability === 'view' || fn.stateMutability === 'pure'));

  const evidenceByRule: ReadonlyArray<() => string[]> = [
    () => collectEvidence(functions, (fn) => MINT_NAMES.has(fn.name)),
    () =>
      hasName(functions, 'pause') && hasName(functions, 'unpause')
        ? collectEvidence(functions, isPausablePair)
        : [],
    () => collectEvidence(functions, (fn) => BLACKLIST_NAMES.has(fn.name)),
    () => collectEvidence(functions, (fn) => UPGRADEABLE_NAMES.has(fn.name)),
    () => collectEvidence(functions, isOwnership),
    () => collectEvidence(functions, (fn) => FEE_NAMES.has(fn.name)),
  ];

  const flags: AbiRiskFlag[] = [];
  FLAG_COPY.forEach((copy, index) => {
    const evidence = evidenceByRule[index]();
    if (evidence.length > 0) {
      flags.push({ ...copy, evidence });
    }
  });
  return flags;
}
