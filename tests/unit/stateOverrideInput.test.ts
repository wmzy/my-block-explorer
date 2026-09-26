// Parser tests for the Interact state-override editor: empty input is a
// no-op (byte-identical wire), valid maps round-trip into the shared
// rulebook's structure, every invalid shape comes back as field-path'd
// sentences with the server's exact wording, and the verdicts stay in
// lockstep with the shared server-side validator on the same inputs.
import { describe, it, expect } from 'vitest';

import { parseStateOverride, type StateOverride } from '@/utils/stateOverride';
import {
  parseStateOverrideInput,
  toViemStateOverride,
} from '@/views/Contract/stateOverrideInput';

const ADDR = '0x1111111111111111111111111111111111111111';
const ADDR_2 = '0x2222222222222222222222222222222222222222';
const SLOT = '0x0000000000000000000000000000000000000000000000000000000000000001';
const VALUE = '0x0000000000000000000000000000000000000000000000000000000000000042';
const OTHER_SLOT = '0x0000000000000000000000000000000000000000000000000000000000000002';

describe('parseStateOverrideInput empty input', () => {
  it('treats an empty string as no override at all', () => {
    expect(parseStateOverrideInput('')).toEqual({ ok: true, value: undefined, warnings: [] });
  });

  it('treats whitespace-only text as no override at all', () => {
    expect(parseStateOverrideInput('  \n\t ')).toEqual({
      ok: true,
      value: undefined,
      warnings: [],
    });
  });

  it('drops an empty JSON object with a warning instead of sending it', () => {
    expect(parseStateOverrideInput('{}')).toEqual({
      ok: true,
      value: undefined,
      warnings: ['stateOverride: empty object — no override will be sent'],
    });
  });
});

describe('parseStateOverrideInput valid maps', () => {
  it('parses a single balance override into the wire structure', () => {
    expect(parseStateOverrideInput(`{"${ADDR}":{"balance":"0x1"}}`)).toEqual({
      ok: true,
      value: { [ADDR]: { balance: '0x1' } },
      warnings: [],
    });
  });

  it('parses an entry carrying every field kind', () => {
    const text = `{"${ADDR}":{"balance":"0x1","nonce":"0x2a","code":"0x6080","state":{"${SLOT}":"${VALUE}"}}}`;
    expect(parseStateOverrideInput(text)).toEqual({
      ok: true,
      value: {
        [ADDR]: {
          balance: '0x1',
          nonce: '0x2a',
          code: '0x6080',
          state: { [SLOT]: VALUE },
        },
      },
      warnings: [],
    });
  });

  it('parses stateDiff and multiple addresses', () => {
    const text =
      `{"${ADDR}":{"stateDiff":{"${SLOT}":"${VALUE}"}},` +
      `"${ADDR_2}":{"nonce":"0x0"}}`;
    const result = parseStateOverrideInput(text);
    expect(result).toEqual({
      ok: true,
      value: {
        [ADDR]: { stateDiff: { [SLOT]: VALUE } },
        [ADDR_2]: { nonce: '0x0' },
      },
      warnings: [],
    });
  });
});

describe('parseStateOverrideInput invalid shapes', () => {
  it('rejects a bad address key with the server sentence', () => {
    const result = parseStateOverrideInput('{"0xzz":{"balance":"0x1"}}');
    expect(result).toEqual({
      ok: false,
      errors: ['stateOverride: address key 0xzz is not a valid hex address'],
    });
  });

  it('rejects a non-hex-quantity balance with a field-path sentence', () => {
    const result = parseStateOverrideInput(`{"${ADDR}":{"balance":"1"}}`);
    expect(result).toEqual({
      ok: false,
      errors: [`${ADDR}.balance: must be a hex quantity like 0x1 (no leading zeros)`],
    });
  });

  it('rejects a leading-zero nonce, odd-length code, and a short state slot', () => {
    // Long raw values are echoed truncated at 42 characters in the
    // server's error sentences (preview()); the short slot is one.
    const shortSlot = SLOT.slice(0, 63);
    const result = parseStateOverrideInput(
      `{"${ADDR}":{"nonce":"0x01","code":"0x608","state":{"${shortSlot}":"${VALUE}"}}}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      `${ADDR}.nonce: must be a hex quantity like 0x1 (no leading zeros)`,
      `${ADDR}.code: must be even-length hex bytecode of at least one byte`,
      `${ADDR}.state: slot key ${shortSlot.slice(0, 42)}… is not a 32-byte hex value`,
    ]);
  });

  it('rejects an unknown per-entry field', () => {
    const result = parseStateOverrideInput(`{"${ADDR}":{"who":"0x1"}}`);
    expect(result).toEqual({
      ok: false,
      errors: [
        `${ADDR}.who: unknown field (expected balance, nonce, code, state, or stateDiff)`,
      ],
    });
  });

  it('rejects an entry with no fields at all', () => {
    const result = parseStateOverrideInput(`{"${ADDR}":{}}`);
    expect(result).toEqual({
      ok: false,
      errors: [`${ADDR}: at least one override field is required`],
    });
  });

  it('enforces the 32-slots-per-map cap', () => {
    const slots = Array.from({ length: 33 }, (_, i) => [
      `0x${(i + 1).toString(16).padStart(64, '0')}`,
      VALUE,
    ]);
    const map = Object.fromEntries(slots);
    const result = parseStateOverrideInput(JSON.stringify({ [ADDR]: { state: map } }));
    expect(result).toEqual({
      ok: false,
      errors: [`${ADDR}.state: too many slots (max 32)`],
    });
  });

  it('enforces the 10-addresses cap', () => {
    const addresses = Array.from(
      { length: 11 },
      (_, i) => [`0x${i.toString(16).padStart(40, '0')}`, { balance: '0x1' }] as const,
    );
    const result = parseStateOverrideInput(JSON.stringify(Object.fromEntries(addresses)));
    expect(result).toEqual({
      ok: false,
      errors: ['stateOverride: too many addresses (max 10)'],
    });
  });

  it('rejects non-object JSON with the server sentence', () => {
    for (const text of ['[{"balance":"0x1"}]', '42', '"0x1"', 'null']) {
      expect(parseStateOverrideInput(text)).toEqual({
        ok: false,
        errors: ['stateOverride: must be an object keyed by address'],
      });
    }
  });

  it('rejects trailing garbage as not valid JSON', () => {
    const result = parseStateOverrideInput(`{"${ADDR}":{"balance":"0x1"}} trailing`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].startsWith('stateOverride: not valid JSON (')).toBe(true);
  });

  it('rejects combining state and stateDiff on one address (the transport refuses the pair)', () => {
    const text = `{"${ADDR}":{"state":{"${SLOT}":"${VALUE}"},"stateDiff":{"${OTHER_SLOT}":"${VALUE}"}}}`;
    const result = parseStateOverrideInput(text);
    expect(result).toEqual({
      ok: false,
      errors: [`${ADDR}.state: cannot combine state and stateDiff on one address`],
    });
  });
});

describe('parseStateOverrideInput stays in lockstep with the server validator', () => {
  // The textarea content is the server's JSON body verbatim, so every
  // shared-rulebook input must produce the identical verdict on both ends.
  const corpus: Array<Record<string, unknown>> = [
    { [ADDR]: { balance: '0x1' } },
    { [ADDR]: { balance: '0x1', nonce: '0x2a', code: '0x6080', state: { [SLOT]: VALUE } } },
    { [ADDR]: { stateDiff: { [SLOT]: VALUE } } },
    { '0xzz': { balance: '0x1' } },
    { [ADDR]: { balance: '1' } },
    { [ADDR]: { nonce: '0x01' } },
    { [ADDR]: { code: '0x608' } },
    { [ADDR]: { who: '0x1' } },
    { [ADDR]: {} },
    {
      [ADDR]: {
        state: { [SLOT.slice(0, 63)]: VALUE },
      },
    },
    Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [
        `0x${i.toString(16).padStart(40, '0')}`,
        { balance: '0x1' },
      ]),
    ),
    {
      [ADDR]: {
        state: Object.fromEntries(
          Array.from({ length: 33 }, (_, i) => [
            `0x${(i + 1).toString(16).padStart(64, '0')}`,
            VALUE,
          ]),
        ),
      },
    },
  ];

  it('renders the same verdict and the same sentences for every corpus input', () => {
    for (const input of corpus) {
      const client = parseStateOverrideInput(JSON.stringify(input));
      const server = parseStateOverride(input);
      expect(client.ok).toBe(server.ok);
      if (!client.ok && !server.ok) {
        expect(client.errors).toEqual(server.details);
      }
    }
  });

  it('agrees with the server on non-object JSON values too', () => {
    for (const input of [[{ balance: '0x1' }], 42, '0x1', null]) {
      const client = parseStateOverrideInput(JSON.stringify(input));
      const server = parseStateOverride(input);
      expect(client.ok).toBe(server.ok);
      if (!client.ok && !server.ok) {
        expect(client.errors).toEqual(server.details);
      }
    }
  });
});

describe('toViemStateOverride', () => {
  it('converts hex quantities to JS numbers and storage maps to [{slot, value}] lists', () => {
    const wire: StateOverride = {
      [ADDR]: {
        balance: '0xde0b6b3a7640000',
        nonce: '0x2a',
        state: { [SLOT]: VALUE },
      },
      [ADDR_2]: { code: '0x6080' },
    };
    expect(toViemStateOverride(wire)).toEqual([
      {
        address: ADDR,
        balance: 1000000000000000000n,
        nonce: 42,
        state: [{ slot: SLOT, value: VALUE }],
      },
      { address: ADDR_2, code: '0x6080' },
    ]);
  });
});
