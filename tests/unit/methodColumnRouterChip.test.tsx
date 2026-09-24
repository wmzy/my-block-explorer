// Method-column protocol-chip rendering: a row whose to-address is in
// the curated known-routers set for the current chain gets the chip
// ('Uniswap V2', …) beside the method display — for both the pending/
// unresolved selector display and the resolved name — while uncurated
// rows render exactly the cells they did before (verified by asserting
// the old structure: name + "+N more" + openchain chip, or the plain
// em-dash/creation displays, with no protocol chip anywhere).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import type { SignatureOutcome } from '@/services/signatures';
import { MethodCell, ProtocolRouterChip, TxMethodCell } from '@/views/Transactions/methodColumn';

const MAINNET_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const MAINNET_SWAP_ROUTER02 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
const UNRELATED_CONTRACT = '0x1111111111111111111111111111111111111111';

// swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
const SWAP_SELECTOR = '0x38ed1739';
const SWAP_CALL = `${SWAP_SELECTOR}0000000000000000000000000000000000000000000000000000000000000020`;

const resolvedOutcome: SignatureOutcome = {
  kind: 'function',
  signatures: ['swapExactTokensForTokens(uint256,uint256,address[],address,uint256)'],
  source: 'openchain',
};

describe('TxMethodCell protocol chip', () => {
  it('chips a curated router row while the selector is still unresolved', () => {
    render(
      <TxMethodCell
        tx={{ inputData: SWAP_CALL, toAddress: MAINNET_V2_ROUTER }}
        outcomes={{}}
        chainId={1}
      />,
    );
    expect(screen.getByText('Uniswap V2')).toBeInTheDocument();
    // The truncated selector keeps its honest placeholder display.
    expect(screen.getByText(`${SWAP_SELECTOR.slice(0, 8)}…`)).toBeInTheDocument();
  });

  it('matches the to-address case-insensitively', () => {
    render(
      <TxMethodCell
        tx={{ inputData: SWAP_CALL, toAddress: MAINNET_SWAP_ROUTER02.toLowerCase() }}
        outcomes={{}}
        chainId={1}
      />,
    );
    expect(screen.getByText('Uniswap V3')).toBeInTheDocument();
  });

  it('chips beside the resolved method name, keeping the openchain provenance chip', () => {
    render(
      <TxMethodCell
        tx={{ inputData: SWAP_CALL, toAddress: MAINNET_SWAP_ROUTER02 }}
        outcomes={{ [SWAP_SELECTOR]: resolvedOutcome }}
        chainId={1}
      />,
    );
    expect(screen.getByText('Uniswap V3')).toBeInTheDocument();
    expect(screen.getByText('swapExactTokensForTokens')).toBeInTheDocument();
    expect(screen.getByText('openchain')).toBeInTheDocument();
  });

  it('renders no chip for the same address on a chain it was not deployed to', () => {
    render(
      <TxMethodCell
        tx={{ inputData: SWAP_CALL, toAddress: MAINNET_V2_ROUTER }}
        outcomes={{ [SWAP_SELECTOR]: resolvedOutcome }}
        chainId={137}
      />,
    );
    expect(screen.queryByText(/Uniswap/)).not.toBeInTheDocument();
    expect(screen.getByText('swapExactTokensForTokens')).toBeInTheDocument();
  });

  it('renders an uncurated row exactly as before: name, "+N more", openchain chip, no protocol chip', () => {
    const twoCandidates: SignatureOutcome = {
      kind: 'function',
      signatures: [
        'transfer(address,uint256)',
        'transfer(bytes4)',
      ],
      source: 'openchain',
    };
    const { container } = render(
      <TxMethodCell
        tx={{ inputData: '0xa9059cbb0000000000000000000000000000000000000000000000000000000000000020', toAddress: UNRELATED_CONTRACT }}
        outcomes={{ '0xa9059cbb': twoCandidates }}
        chainId={1}
      />,
    );
    expect(screen.queryByText(/Uniswap/)).not.toBeInTheDocument();
    expect(screen.getByText('transfer')).toBeInTheDocument();
    expect(screen.getByText('(+1 more)')).toBeInTheDocument();
    expect(screen.getByText('openchain')).toBeInTheDocument();
    // Structure unchanged from the pre-chip rendering: one wrapping span
    // (title=full signature) around name + suffix + provenance chip.
    expect(container.querySelectorAll('span').length).toBe(4);
  });

  it('keeps the plain em-dash for a no-calldata row even when the to-address is a curated router', () => {
    render(
      <TxMethodCell tx={{ inputData: '0x', toAddress: MAINNET_V2_ROUTER }} outcomes={{}} chainId={1} />,
    );
    expect(screen.queryByText(/Uniswap/)).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('never chips a contract-creation row (no to-address)', () => {
    render(
      <TxMethodCell tx={{ inputData: SWAP_CALL, toAddress: '' }} outcomes={{}} chainId={1} />,
    );
    expect(screen.queryByText(/Uniswap/)).not.toBeInTheDocument();
    expect(screen.getByText('Contract Creation')).toBeInTheDocument();
  });
});

describe('MethodCell routerLabel prop', () => {
  it('renders the chip for the selector display when a label is passed', () => {
    render(
      <MethodCell inputData={SWAP_CALL} toAddress={MAINNET_V2_ROUTER} outcome={undefined} routerLabel="Uniswap V2" />,
    );
    expect(screen.getByText('Uniswap V2')).toBeInTheDocument();
    expect(screen.getByText(`${SWAP_SELECTOR.slice(0, 8)}…`)).toBeInTheDocument();
  });

  it('renders nothing extra when no label is passed (backward-compatible call shape)', () => {
    const { container } = render(
      <MethodCell inputData={SWAP_CALL} toAddress={MAINNET_V2_ROUTER} outcome={resolvedOutcome} />,
    );
    expect(screen.queryByText(/Uniswap/)).not.toBeInTheDocument();
    // Single candidate: wrapper span (title=signature) + name + openchain
    // chip — exactly the pre-chip structure.
    expect(container.querySelectorAll('span').length).toBe(3);
  });
});

describe('ProtocolRouterChip (detail-page reuse)', () => {
  it('renders the label for a curated router on its chain', () => {
    const { container } = render(<ProtocolRouterChip chainId={1} toAddress={MAINNET_V2_ROUTER} />);
    expect(screen.getByText('Uniswap V2')).toBeInTheDocument();
    expect(container.textContent).toBe('Uniswap V2');
  });

  it('renders nothing for an uncurated address or chain', () => {
    const { container: uncurated } = render(
      <ProtocolRouterChip chainId={1} toAddress={UNRELATED_CONTRACT} />,
    );
    expect(uncurated.textContent).toBe('');
    const { container: wrongChain } = render(
      <ProtocolRouterChip chainId={137} toAddress={MAINNET_V2_ROUTER} />,
    );
    expect(wrongChain.textContent).toBe('');
  });
});
