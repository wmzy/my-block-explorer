// Button loading-state pins: the loading spinner span must carry the
// shared border-spinner base (spinnerBase — the same exported css class
// the events table's loading pane adopts). Under vitest, linaria's css
// tag returns deterministic class tokens, so "class contains spinnerBase"
// is a real observable contract: it fails if the base is dropped from
// the cx or the export is detached. The wrapped HazeButton is the REAL
// haze-ui component (the setup mock only stubs the 'haze-ui' barrel;
// this wrapper imports the per-component submodule), so the span search
// is structural rather than position-based.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Button, spinnerBase } from '@/components/ui/Button';

const spansWithSpinnerBase = (button: HTMLElement): HTMLElement[] =>
  Array.from(button.querySelectorAll('span')).filter(el =>
    (el.getAttribute('class') ?? '').split(/\s+/).includes(spinnerBase),
  );

describe('Button loading spinner', () => {
  it('renders the shared border-spinner base next to the label while loading', () => {
    render(<Button loading>Confirm</Button>);

    const button = screen.getByRole('button', { name: /Confirm/ });
    // Loading also disables the control.
    expect(button).toBeDisabled();
    expect(spansWithSpinnerBase(button)).toHaveLength(1);
  });

  it('renders no spinner span when idle', () => {
    render(<Button>Confirm</Button>);

    const button = screen.getByRole('button', { name: /Confirm/ });
    expect(button).toBeEnabled();
    expect(spansWithSpinnerBase(button)).toHaveLength(0);
  });
});
