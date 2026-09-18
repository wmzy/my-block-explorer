// CustomAbiPanel unit tests: the paste-ABI panel is rendered directly with
// stubbed parent callbacks (the parent owns persistence). Covers the
// entry-count honesty of the Valid-ABI feedback (constructor/fallback/
// receive entries are accepted but dropped when the ABI is parsed) and the
// storage note that discloses cross-session persistence.
import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('states plainly that pasting neither verifies nor shares the contract', () => {
    renderPanel();

    expect(
      screen.getByText(/Pasting an ABI does not verify the contract and is not shared with other users/),
    ).toBeInTheDocument();
  });
});

describe('CustomAbiPanel copy', () => {
  const ORIGINAL_EXEC_COMMAND = document.execCommand;

  // userEvent.setup() swaps in its own navigator.clipboard/execCommand
  // stubs, so these tests stick to fireEvent and stub the platform
  // APIs directly.
  const stubClipboard = (writeText?: (text: string) => Promise<void>) => {
    Object.defineProperty(navigator, 'clipboard', {
      value: writeText ? { writeText } : undefined,
      configurable: true,
    });
  };

  afterEach(() => {
    stubClipboard(undefined);
    document.execCommand = ORIGINAL_EXEC_COMMAND;
  });

  it('copies the stored ABI through the async clipboard API', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    renderPanel({ storedRaw: '[{"type":"function","name":"owner"}]' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy ABI' }));

    expect(writeText).toHaveBeenCalledWith('[{"type":"function","name":"owner"}]');
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });

  it('copies the pasted draft when nothing is applied yet', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Custom ABI JSON'), {
      target: { value: '[{"type":"function","name":"owner"}]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy ABI' }));

    expect(writeText).toHaveBeenCalledWith('[{"type":"function","name":"owner"}]');
  });

  it('keeps Copy disabled with nothing stored or pasted', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Copy ABI' })).toBeDisabled();
  });

  it('falls back to execCommand when the clipboard API is unavailable', async () => {
    stubClipboard(undefined);
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    renderPanel({ storedRaw: '[{"type":"function","name":"owner"}]' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy ABI' }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });

  it('reports a failed copy honestly', async () => {
    stubClipboard(undefined);
    document.execCommand = vi.fn(() => false);
    renderPanel({ storedRaw: '[{"type":"function","name":"owner"}]' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy ABI' }));

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });
});
