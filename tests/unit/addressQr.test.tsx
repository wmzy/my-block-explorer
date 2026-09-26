// AddressQr contract: the modal encodes the CHECKSUMMED address (plain
// hex, not an EIP-681 URI) as a genuinely non-empty QR symbol, shows the
// payload text, and offers the copy-address fallback. The QR renders
// through qrcode's pure SVG string renderer — no canvas — so these
// assertions run the REAL encoder (the module is not mocked), and the
// symbol is asserted structurally (viewBox + non-empty module path).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { getAddress } from 'viem';
import QRCode from 'qrcode';
import { AddressQr } from '@/components/ui/AddressQr';

const LOWERCASE = '0x1234567890abcdef1234567890abcdef12345678';
const CHECKSUMMED = getAddress(LOWERCASE);

vi.mock('sonner', () => ({ toast: vi.fn() }));
import { toast } from 'sonner';

beforeEach(() => {
  vi.mocked(toast).mockClear();
  // jsdom ships no clipboard API — the fallback's contract is the
  // writeText call, stubbed here.
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

const openModal = () => fireEvent.click(screen.getByTestId('address-qr-button'));

describe('AddressQr', () => {
  it('renders nothing for an address the explorer itself would reject', () => {
    const { container } = render(<AddressQr address="not-an-address" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('actually OPENS the dialog (data-state) and closes again — a plain-value open prop never re-opens haze-ui Dialogs', () => {
    // Regression shape of a real browser bug the content assertions below
    // could not catch: haze-ui's Dialog treats a plain boolean `open` as
    // the INITIAL value only (react-use-control seeds useState from it and
    // ignores later flips), so the trigger's state change left the dialog
    // permanently closed while every child assertion (title, payload, svg)
    // kept passing — the dialog renders its children even when closed.
    // The open state must therefore reach the Dialog as a Control, and the
    // visible-open contract is asserted here directly.
    render(<AddressQr address={LOWERCASE} />);
    // jsdom runs against the setup.ts Dialog mock (the real component
    // needs a browser <dialog>); the mock's presence contract mirrors the
    // real open state — see the control-aware mock note in tests/setup.ts.
    const content = () => screen.queryByTestId('address-qr-payload');
    expect(content()).toBeNull(); // closed before the click

    openModal();
    expect(content()).toBeInTheDocument();

    // Copy does not close; the close path (dialog-close button = onClose)
    // does.
    fireEvent.click(screen.getByTestId('address-qr-copy'));
    expect(content()).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('dialog-close'));
    expect(content()).toBeNull();
  });

  it('encodes the checksummed address as a real, non-empty QR symbol', async () => {
    render(<AddressQr address={LOWERCASE} />);
    openModal();

    // The payload text is the checksummed spelling of the input.
    await waitFor(() => {
      expect(screen.getByTestId('address-qr-payload')).toHaveTextContent(CHECKSUMMED);
    });

    // The symbol itself: an inline SVG with a viewBox and a non-empty
    // module path, produced by the real (unmocked) qrcode encoder.
    const svg = await waitFor(() => {
      const plate = screen.getByTestId('address-qr-plate');
      const el = plate.querySelector('svg');
      expect(el).not.toBeNull();
      return el as SVGSVGElement;
    });
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    const path = svg.querySelector('path[d]');
    expect(path).not.toBeNull();
    expect((path as SVGPathElement).getAttribute('d')?.length ?? 0).toBeGreaterThan(10);

    // Cross-check against the encoder directly: the same payload must
    // produce a matrix with dark modules (the honest encode assertion).
    const qr = QRCode.create(CHECKSUMMED);
    expect(qr.modules.size).toBeGreaterThan(0);
    let dark = 0;
    for (const bit of qr.modules.data) {
      if (bit) dark += 1;
    }
    expect(dark).toBeGreaterThan(0);
  });

  it('plain hex payload — never an EIP-681 URI', async () => {
    render(<AddressQr address={LOWERCASE} />);
    openModal();
    await waitFor(() => {
      const payload = screen.getByTestId('address-qr-payload').textContent ?? '';
      expect(payload).toBe(CHECKSUMMED);
      expect(payload).not.toContain('ethereum:');
    });
  });

  it('shows the dialog title and the copy-address fallback', async () => {
    render(<AddressQr address={LOWERCASE} />);
    openModal();
    expect(await screen.findByText('Scan to open in a wallet')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('address-qr-copy'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CHECKSUMMED);
    });
  });

  it('says so honestly when the encoder fails (copy stays available)', async () => {
    // The one failure path: the renderer rejecting. Mocked at the module
    // boundary because the real encoder cannot fail on a valid address.
    vi.spyOn(QRCode, 'toString').mockRejectedValueOnce(new Error('encode failed'));
    render(<AddressQr address={LOWERCASE} />);
    openModal();
    const error = await screen.findByTestId('address-qr-error');
    expect(error).toHaveTextContent('could not be generated');
    expect(screen.getByTestId('address-qr-copy')).toBeInTheDocument();
    expect(screen.queryByTestId('address-qr-plate')?.querySelector('svg')).toBeNull();
  });
});
