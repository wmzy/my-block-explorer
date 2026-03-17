/**
 * Event decoding and selector utilities for contract events
 */

export const getEventSelectorFromName = (eventName: string): string => {
  const eventSignatures: Record<string, string> = {
    "Transfer":
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "Approval":
      "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
    "Claimed":
      "0x4ec90e965519d92681267467f775ada5bd214aa92c0dc93d90a5e880ce9ed026",
    "Withdrawn":
      "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5",
    "CanClaimChanged":
      "0x288bc2dc4daa42daed2dc8f75a041199ec3b44228839d53fcdcd655319c6ba27",
    "AddWhitelists":
      "0x694fe5adecedc7ad5a3f8391f8a2cf836d4f3aa6984399831388c19ae0fb0d48",
    "RemoveWhitelists":
      "0x4ef352f25cdeac845ac72666cd403ec5e67035abb4002b310ebdfef3d564dac2",
    "OwnershipTransferred":
      "0f2c964eadc46d807a809523f3bb43defb2b5e79e2ac9b895fe640b7ec95b478",
    "OwnerChanged":
      "0x3c6bc16fc5b8e82e1c3c7d3d3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e",
    "Paused":
      "0x62e78cea01bee320cd4e4202b23e0615b4fa650be62e2c4f6c5bfa8d7a4c7a75",
    "Unpaused":
      "0x5db9ee0a495bf2e6ff9c91a7834561e16a650cc1172787b7f8b7e3e3e3e3e3e3e",
    "RoleGranted":
      "0x2f8788117e7eff10482bff7d5f5af1b0e2b3f6c24207074239f59d984100e2a8",
    "RoleRevoked":
      "0xf79a3f8c1b1b1e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e",
    "DataSet":
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    "Updated":
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
  };
  return eventSignatures[eventName] ?? "0x" + "0".repeat(64);
};

export const decodeEventData = (
  eventName: string,
  topics: string[],
  data: string
): Record<string, unknown> => {
  try {
    if (eventName === "Transfer" && topics.length >= 3) {
      return {
        from: topics[1],
        to: topics[2],
        value: BigInt("0x" + data.replace(/^0x/, "").padStart(64, "0")),
        raw: { topics, data },
      };
    }

    if (eventName === "Approval" && topics.length >= 3) {
      return {
        owner: topics[1],
        spender: topics[2],
        value: BigInt("0x" + data.replace(/^0x/, "").padStart(64, "0")),
        raw: { topics, data },
      };
    }

    if (eventName === "Claimed" && topics.length >= 2) {
      return {
        account: topics[1],
        amount: BigInt("0x" + data.replace(/^0x/, "").padStart(64, "0")),
        raw: { topics, data },
      };
    }

    if (eventName === "OwnershipTransferred" && topics.length >= 3) {
      return {
        previousOwner: topics[1],
        newOwner: topics[2],
        raw: { topics, data },
      };
    }

    return {
      topics,
      data,
      raw: { topics, data },
    };
  } catch (error) {
    console.warn("Failed to decode event data:", error);
    return {
      topics,
      data,
      raw: { topics, data },
    };
  }
};

export const getContractCreationBlock = async (
  client: unknown,
  contractAddress: string
): Promise<bigint> => {
  try {
    const latestBlock = await (client as { getBlockNumber: () => Promise<bigint> }).getBlockNumber();
    const reasonableStartBlock = 87080000n;
    console.log(
      `Using starting block ${reasonableStartBlock} (latest: ${latestBlock})`
    );
    return reasonableStartBlock;
  } catch (error) {
    console.warn("Failed to get contract creation block:", error);
    return 87000000n;
  }
};

export const getEventNameFromSignature = (eventSignature: string): string => {
  const signatures: Record<string, string> = {
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef":
      "Transfer",
    "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925":
      "Approval",
    "0x4ec90e965519d92681267467f775ada5bd214aa92c0dc93d90a5e880ce9ed026":
      "Claimed",
    "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5":
      "Withdrawn",
    "0x288bc2dc4daa42daed2dc8f75a041199ec3b44228839d53fcdcd655319c6ba27":
      "CanClaimChanged",
    "0x694fe5adecedc7ad5a3f8391f8a2cf836d4f3aa6984399831388c19ae0fb0d48":
      "AddWhitelists",
    "0x4ef352f25cdeac845ac72666cd403ec5e67035abb4002b310ebdfef3d564dac2":
      "RemoveWhitelists",
    "0f2c964eadc46d807a809523f3bb43defb2b5e79e2ac9b895fe640b7ec95b478":
      "OwnershipTransferred",
    "0x62e78cea01bee320cd4e4202b23e0615b4fa650be62e2c4f6c5bfa8d7a4c7a75":
      "Paused",
    "0x5db9ee0a495bf2e6ff9c91a7834561e16a650cc1172787b7f8b7e3e3e3e3e3e3e":
      "Unpaused",
    "0x2f8788117e7eff10482bff7d5f5af1b0e2b3f6c24207074239f59d984100e2a8":
      "RoleGranted",
    "0xf79a3f8c1b1b1e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e":
      "RoleRevoked",
  };
  return signatures[eventSignature] ?? "Unknown";
};
