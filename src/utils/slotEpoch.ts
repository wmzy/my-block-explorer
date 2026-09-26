// Timestamp-derived beacon slot/epoch math (Blockscout parity): for chains
// whose consensus schedule is publicly documented and fixed, a block
// timestamp maps deterministically onto the slot/epoch grid the consensus
// layer keeps time by. The map below is deliberately tiny — only chains
// with a canonical, published schedule belong here; an unmapped chain
// renders no slot at all rather than a guessed one (honesty contract).

export type SlotEpochSchedule = {
  /** Unix seconds of the consensus chain's genesis (slot 0 start). */
  genesisTimestamp: number;
  /** Slot duration in seconds (consensus-specs SECONDS_PER_SLOT). */
  secondsPerSlot: number;
  /** Slots per epoch (consensus-specs SLOTS_PER_EPOCH). */
  slotsPerEpoch: number;
};

export type SlotEpoch = {
  slot: number;
  epoch: number;
};

// Ethereum mainnet (chainId 1):
// - Beacon chain genesis 2020-12-01 12:00:23 UTC = Unix 1606824023
//   (eth2book "Upgrading Ethereum" 4.2 Upgrade History; consensus-specs
//   MIN_GENESIS_TIME era, genesis fired 23s past the min).
// - SECONDS_PER_SLOT = 12, SLOTS_PER_EPOCH = 32 (consensus-specs).
// Cross-check (verified against Etherscan block 15537394, the first
// post-Merge block): its timestamp is Unix 1663224179 (2022-09-15
// 06:42:59 UTC) and Etherscan reports Slot 4700013 / Epoch 146875.
// Arithmetic: 1663224179 - 1606824023 = 56,400,156 = 12 * 4,700,013
// exactly (the timestamp sits on the slot-4700013 start boundary), and
// floor(4,700,013 / 32) = 146,875. These values are pinned by
// tests/unit/slotEpoch.test.ts.
const CHAIN_SLOT_EPOCH_SCHEDULES: Readonly<Record<number, SlotEpochSchedule>> = {
  1: { genesisTimestamp: 1_606_824_023, secondsPerSlot: 12, slotsPerEpoch: 32 },
};

/**
 * Derive the consensus slot/epoch whose window contains a Unix-seconds
 * timestamp, for chains with a known schedule.
 *
 * Returns undefined when the chain has no known schedule (never a guess)
 * or the timestamp predates genesis. All inputs and outputs stay far
 * below 2^53, so the divisions are exact integer math despite JS floats.
 *
 * Known limitation, accepted by contract: pre-Merge mainnet blocks
 * (genesis <= timestamp < Merge) also derive a value — the beacon grid
 * has ticked since genesis, so the result names the slot window the
 * timestamp falls in, but no execution block was proposed in it.
 */
export function deriveSlotEpoch(chainId: number, timestampSeconds: number): SlotEpoch | undefined {
  const schedule = CHAIN_SLOT_EPOCH_SCHEDULES[chainId];
  if (schedule === undefined) return undefined;
  if (!Number.isFinite(timestampSeconds)) return undefined;
  if (timestampSeconds < schedule.genesisTimestamp) return undefined;
  const slot = Math.floor((timestampSeconds - schedule.genesisTimestamp) / schedule.secondsPerSlot);
  const epoch = Math.floor(slot / schedule.slotsPerEpoch);
  return { slot, epoch };
}

/**
 * Same derivation from the ISO timestamp string the block RPC layer
 * normalizes to (`RpcBlock.timestamp`, e.g. "2026-09-26T12:00:23.000Z").
 * An unparseable timestamp collapses to undefined — never a fabricated
 * slot. Fractional seconds floor into the containing slot, matching the
 * Unix-seconds variant.
 */
export function deriveSlotEpochFromIso(chainId: number, isoTimestamp: string): SlotEpoch | undefined {
  const milliseconds = Date.parse(isoTimestamp);
  if (Number.isNaN(milliseconds)) return undefined;
  return deriveSlotEpoch(chainId, Math.floor(milliseconds / 1000));
}
