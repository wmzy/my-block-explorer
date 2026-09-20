// Zero-address miner classification (B1): Bor-style PoS chains do not put
// the validator in the EVM header, so public RPCs return the zero address
// as the block miner. Views must not render a link to the meaningless
// zero-address page — describeBlockProducer is the single classifier they
// all consult, so its zero/empty/real verdicts are pinned here.
import { describe, it, expect } from 'vitest';

import { describeBlockProducer } from '@/utils/blockRpcData';

const ZERO = `0x${'0'.repeat(40)}`;
const VALIDATOR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

describe('describeBlockProducer', () => {
  it('classifies the 40-zero address as unknown', () => {
    expect(describeBlockProducer(ZERO)).toEqual({ kind: 'unknown' });
  });

  it('classifies an empty string as unknown', () => {
    expect(describeBlockProducer('')).toEqual({ kind: 'unknown' });
  });

  it('classifies a real miner address as validator, preserving it verbatim', () => {
    expect(describeBlockProducer(VALIDATOR)).toEqual({
      kind: 'validator',
      address: VALIDATOR,
    });
  });

  it('trims surrounding whitespace before classifying', () => {
    expect(describeBlockProducer(`  ${VALIDATOR} `)).toEqual({
      kind: 'validator',
      address: VALIDATOR,
    });
    expect(describeBlockProducer(` ${ZERO}\n`)).toEqual({ kind: 'unknown' });
  });
});
