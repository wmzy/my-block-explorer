import { describe, it, expect } from "vitest";
import {
  getEventSelectorFromName,
  getEventNameFromSignature,
  decodeEventData,
} from "@/utils/events";

const TRANSFER_SELECTOR =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL_SELECTOR =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

describe("events utils", () => {
  describe("getEventSelectorFromName", () => {
    it('getEventSelectorFromName("Transfer") returns the Transfer event selector', () => {
      expect(getEventSelectorFromName("Transfer")).toBe(TRANSFER_SELECTOR);
    });

    it('getEventSelectorFromName("Unknown") returns zero-padded default', () => {
      expect(getEventSelectorFromName("Unknown")).toBe("0x" + "0".repeat(64));
    });
  });

  describe("getEventNameFromSignature", () => {
    it("getEventNameFromSignature(transferSig) returns Transfer", () => {
      expect(getEventNameFromSignature(TRANSFER_SELECTOR)).toBe("Transfer");
    });

    it("getEventNameFromSignature(unknownSig) returns Unknown", () => {
      expect(getEventNameFromSignature("0xunknown123")).toBe("Unknown");
    });
  });

  describe("decodeEventData", () => {
    it('decodeEventData("Transfer", topics, data) decodes correctly', () => {
      const topics = [
        TRANSFER_SELECTOR,
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
      ];
      const data = "0x0000000000000000000000000000000000000000000000000000000000000064";

      const result = decodeEventData("Transfer", topics, data);

      expect(result).toMatchObject({
        from: topics[1],
        to: topics[2],
        value: 100n,
      });
      expect(result).toHaveProperty("raw", { topics, data });
    });

    it('decodeEventData("Approval", topics, data) decodes correctly', () => {
      const topics = [
        APPROVAL_SELECTOR,
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
      ];
      const data = "0x00000000000000000000000000000000000000000000000000000000000000ff";

      const result = decodeEventData("Approval", topics, data);

      expect(result).toMatchObject({
        owner: topics[1],
        spender: topics[2],
        value: 255n,
      });
      expect(result).toHaveProperty("raw", { topics, data });
    });

    it('decodeEventData("UnknownEvent", topics, data) returns raw data', () => {
      const topics = ["0xabc", "0xdef"];
      const data = "0x123456";

      const result = decodeEventData("UnknownEvent", topics, data);

      expect(result).toEqual({
        topics,
        data,
        raw: { topics, data },
      });
    });
  });
});
