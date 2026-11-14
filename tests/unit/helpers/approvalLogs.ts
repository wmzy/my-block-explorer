// Shared Approval/ApprovalForAll log fixture family for the approval
// suite (approvalScanService / approvalScanKinds / approvalHistory — the
// three files carried byte-identical copies until 2026-11-14). Wire
// shapes pinned here once: on-chain topics carry the lowercase address
// bytes, ERC-721 Approval shares the ERC-20 signature topic0 (only the
// indexed-topic count splits them), and ERC-1155 carries its approved
// flag in the data word.
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  erc1155Abi,
  numberToHex,
  parseAbiParameters,
  pad,
  type Address,
  type Hex,
} from 'viem';
import type { ScanLog } from '@/services/ApprovalScanService';

export const APPROVAL_TOPIC = encodeEventTopics({ abi: erc20Abi, eventName: 'Approval' })[0];
export const APPROVAL_FOR_ALL_TOPIC = encodeEventTopics({
  abi: erc1155Abi,
  eventName: 'ApprovalForAll',
})[0];
// ERC-721 Approval shares the ERC-20 signature hash by construction.
export const ERC721_APPROVAL_TOPIC = APPROVAL_TOPIC;

// On-chain topics carry the lowercase address bytes. (The cast is needed
// by tsc — pad wants a 0x-template — and not flagged by eslint.)
export const topicAddress = (address: Address): Hex =>
  pad(address.toLowerCase() as Address, { size: 32 });

export const txHashOf = (block: number): Hex => `0x${block.toString(16).padStart(64, '0')}`;

export const erc20Log = (
  token: Address,
  owner: Address,
  spender: Address,
  value: bigint,
  block: number,
  logIndex: number,
): ScanLog => ({
  address: token,
  topics: [APPROVAL_TOPIC, topicAddress(owner), topicAddress(spender)],
  data: encodeAbiParameters(parseAbiParameters('uint256'), [value]),
  blockNumber: BigInt(block),
  transactionHash: txHashOf(block),
  logIndex,
});

// ERC-721 Approval: owner, approved AND tokenId are all indexed → 4 topics.
export const erc721Log = (
  token: Address,
  owner: Address,
  approved: Address,
  tokenId: bigint,
  block: number,
  logIndex: number,
): ScanLog => ({
  address: token,
  topics: [
    ERC721_APPROVAL_TOPIC,
    topicAddress(owner),
    topicAddress(approved),
    numberToHex(tokenId, { size: 32 }),
  ],
  data: '0x',
  blockNumber: BigInt(block),
  transactionHash: txHashOf(block),
  logIndex,
});

// ERC-1155 ApprovalForAll: owner + operator indexed, the flag in data.
export const erc1155Log = (
  token: Address,
  owner: Address,
  operator: Address,
  approved: boolean,
  block: number,
  logIndex: number,
): ScanLog => ({
  address: token,
  topics: [APPROVAL_FOR_ALL_TOPIC, topicAddress(owner), topicAddress(operator)],
  data: encodeAbiParameters(parseAbiParameters('bool'), [approved]),
  blockNumber: BigInt(block),
  transactionHash: txHashOf(block),
  logIndex,
});
