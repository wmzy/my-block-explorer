// Storage layout types for EVM contract storage inspection
// Matches Etherscan/Sourcify storage layout API response format

/**
 * Represents a single storage variable in a contract's layout
 */
export type StorageMember = {
  astId: number;
  contract: string;
  label: string;
  offset: number;
  slot: `${number}`;
  type: string;
};

/**
 * Base type for inplace-encoded storage types
 */
export type InplaceStorageType<L extends string = string, B extends number = number> = {
  encoding: 'inplace';
  label: L;
  numberOfBytes: `${B}`;
};

export type StorageAddress = InplaceStorageType<'address', 20>;
export type StorageContract = InplaceStorageType<`contract ${string}`, 20>;
export type StorageBool = InplaceStorageType<'bool', 1>;
export type StorageUint = InplaceStorageType<`uint${number}`, number>;
export type StorageInt = InplaceStorageType<`int${number}`, number>;
export type StorageBytesN = InplaceStorageType<`bytes${number}`, number>;
export type StorageEnum = InplaceStorageType<`enum ${string}`, 1>;

/**
 * Fixed-size array stored inplace in storage
 */
export type StorageArray = InplaceStorageType<`${string}[${number}]`, number> & {
  base: string;
};

/**
 * Dynamic array with length stored in slot, elements in keccak256(slot) onwards
 */
export type StorageDynamicArray = {
  base: string;
  encoding: 'dynamic_array';
  label: `${string}[]`;
  numberOfBytes: '32';
};

/**
 * Dynamic bytes type (bytes, string)
 */
export type StorageBytes = {
  encoding: 'bytes';
  label: 'bytes';
  numberOfBytes: '32';
};

export type StorageString = {
  encoding: 'bytes';
  label: 'string';
  numberOfBytes: '32';
};

/**
 * Struct with members
 */
export type StorageStruct = InplaceStorageType<`struct ${string}`, number> & {
  members: StorageMember[];
};

/**
 * Mapping with key-value pairs stored at keccak256(key . slot)
 */
export type StorageMapping = {
  encoding: 'mapping';
  key: string;
  value: string;
  label: string;
  numberOfBytes: '32';
};

/**
 * Discriminated union of all storage type encodings
 */
export type StorageType =
  | StorageAddress
  | StorageContract
  | StorageBool
  | StorageArray
  | StorageDynamicArray
  | StorageBytes
  | StorageString
  | StorageStruct
  | StorageMapping
  | StorageUint
  | StorageInt
  | StorageBytesN
  | StorageEnum;

/**
 * Map of type labels to their storage type definitions
 */
export type TypesMap = Record<string, StorageType>;

/**
 * Full storage layout from compiler output
 */
export type StorageLayout = {
  storage: StorageMember[];
  types: TypesMap | null;
};

/**
 * API response for storage layout requests
 */
export type StorageLayoutResponse = {
  found: boolean;
  layout?: StorageLayout;
  source?: 'etherscan' | 'sourcify' | 'fetcher' | 'evmole';
  error?: string;
};

/**
 * Represents a single storage slot value read from RPC
 */
export type StorageSlotValue = {
  slot: `${number}`;
  value: `0x${string}`;
  // Decoded value if ABI type information is available
  decoded?: {
    type: string;
    value: unknown;
  };
};
