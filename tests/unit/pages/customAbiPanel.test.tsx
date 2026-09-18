// CustomAbiPanel unit tests: the paste-ABI panel is rendered directly with
// stubbed parent callbacks (the parent owns persistence). Covers the
// entry-count honesty of the Valid-ABI feedback (constructor/fallback/
// receive entries are accepted but dropped when the ABI is parsed) and the
// storage note that discloses cross-session persistence.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CustomAbiPanel } from '@/views/Contract/CustomAbiPanel';

const renderPanel = (props: Partial<Parameters<typeof CustomAbiPanel>[0]> = {}) =>
  render(
    <CustomAbiPanel storedRaw="" onApply={vi.fn()} onClear={vi.fn()} {...props} />,
  );

const paste = (raw: string) => {
  fireEvent.change(screen.getByLabelText('Custom ABI JSON'), { target: { value: raw } });
  fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
};

describe('CustomAbiPanel validation feedback', () => {
  it('discloses constructor/fallback/receive entries the tabs will ignore', () => {
    renderPanel();

    paste(
      JSON.stringify([
        { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
        { type: 'fallback', stateMutability: 'payable' },
        { type: 'receive', stateMutability: 'payable' },
        {
          type: 'function',
          name: 'owner',
          inputs: [],
          outputs: [],
          stateMutability: 'view',
        },
      ]),
    );

    expect(
      screen.getByText('Valid ABI: 4 entries (3 constructor/fallback/receive entries ignored)'),
    ).toBeInTheDocument();
  });

  it('counts a single ignored entry in the singular', () => {
    renderPanel();

    paste(
      JSON.stringify([
        { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
        {
          type: 'function',
          name: 'owner',
          inputs: [],
          outputs: [],
          stateMutability: 'view',
        },
      ]),
    );

    expect(
      screen.getByText('Valid ABI: 2 entries (1 constructor/fallback/receive entry ignored)'),
    ).toBeInTheDocument();
  });

  it('omits the parenthetical when every entry is callable', () => {
    renderPanel();

    paste(
      JSON.stringify([
        {
          type: 'function',
          name: 'owner',
          inputs: [],
          outputs: [],
          stateMutability: 'view',
        },
      ]),
    );

    expect(screen.getByText('Valid ABI: 1 entry')).toBeInTheDocument();
  });
});

describe('CustomAbiPanel storage note', () => {
  it('says the ABI persists across sessions', () => {
    renderPanel();

    expect(
      screen.getByText(/persists across sessions/, { exact: false }),
    ).toBeInTheDocument();
  });
});
