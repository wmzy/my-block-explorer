import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Collapsible } from '@/components/ui/Collapsible';

describe('Collapsible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders collapsed by default', () => {
      render(
        <Collapsible title="Test Title">
          <div data-testid="content">Hidden content</div>
        </Collapsible>,
      );

      expect(screen.getByText('Test Title')).toBeInTheDocument();
      expect(screen.getByTestId('content').parentElement).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders expanded when defaultExpanded is true', () => {
      render(
        <Collapsible title="Test Title" defaultExpanded>
          <div>Visible content</div>
        </Collapsible>,
      );

      expect(screen.getByText('Test Title')).toBeInTheDocument();
      expect(screen.getByText('Visible content')).toBeVisible();
    });

    it('renders badge when provided', () => {
      render(
        <Collapsible title="Test Title" badge={<span data-testid="badge">New</span>}>
          <div>Content</div>
        </Collapsible>,
      );

      expect(screen.getByTestId('badge')).toBeInTheDocument();
      expect(screen.getByText('New')).toBeInTheDocument();
    });

    it('renders children content when expanded', () => {
      render(
        <Collapsible title="Title" defaultExpanded>
          <p>First paragraph</p>
          <p>Second paragraph</p>
        </Collapsible>,
      );

      expect(screen.getByText('First paragraph')).toBeVisible();
      expect(screen.getByText('Second paragraph')).toBeVisible();
    });

    it('applies custom className', () => {
      render(
        <Collapsible title="Title" className="custom-class">
          <div>Content</div>
        </Collapsible>,
      );

      const container = screen.getByRole('button').closest('.custom-class');
      expect(container).toBeInTheDocument();
    });
  });

  describe('interaction', () => {
    it('toggles expand/collapse on header click', () => {
      render(
        <Collapsible title="Clickable Title">
          <div data-testid="toggle-content">Toggle content</div>
        </Collapsible>,
      );

      const content = screen.getByTestId('toggle-content').parentElement;
      expect(content).toHaveAttribute('aria-hidden', 'true');

      fireEvent.click(screen.getByRole('button'));
      expect(content).toHaveAttribute('aria-hidden', 'false');

      fireEvent.click(screen.getByRole('button'));
      expect(content).toHaveAttribute('aria-hidden', 'true');
    });

    it('toggles expand/collapse on Enter key press', () => {
      render(
        <Collapsible title="Keyboard Title">
          <div>Keyboard content</div>
        </Collapsible>,
      );

      const header = screen.getByRole('button');
      fireEvent.keyDown(header, { key: 'Enter' });

      expect(screen.getByText('Keyboard content')).toBeVisible();
    });

    it('toggles expand/collapse on Space key press', () => {
      render(
        <Collapsible title="Space Title">
          <div>Space content</div>
        </Collapsible>,
      );

      const header = screen.getByRole('button');
      fireEvent.keyDown(header, { key: ' ' });

      expect(screen.getByText('Space content')).toBeVisible();
    });

    it('allows multiple toggle cycles', () => {
      render(
        <Collapsible title="Multiple Toggles">
          <div data-testid="toggle-content">Toggle content</div>
        </Collapsible>,
      );

      const header = screen.getByRole('button');
      const content = screen.getByTestId('toggle-content').parentElement;

      fireEvent.click(header);
      expect(content).toHaveAttribute('aria-hidden', 'false');

      fireEvent.click(header);
      expect(content).toHaveAttribute('aria-hidden', 'true');

      fireEvent.click(header);
      expect(content).toHaveAttribute('aria-hidden', 'false');
    });
  });

  describe('accessibility', () => {
    it('has role="button" on header', () => {
      render(
        <Collapsible title="Accessible Title">
          <div>Content</div>
        </Collapsible>,
      );

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('has aria-expanded set to false when collapsed', () => {
      render(
        <Collapsible title="Title">
          <div>Content</div>
        </Collapsible>,
      );

      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    });

    it('has aria-expanded set to true when expanded', () => {
      render(
        <Collapsible title="Title" defaultExpanded>
          <div>Content</div>
        </Collapsible>,
      );

      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    });

    it('has aria-hidden on content when collapsed', () => {
      render(
        <Collapsible title="Title">
          <div data-testid="hidden-content">Hidden</div>
        </Collapsible>,
      );

      const content = screen.getByTestId('hidden-content').parentElement;
      expect(content).toHaveAttribute('aria-hidden', 'true');
    });

    it('has aria-hidden set to false on content when expanded', () => {
      render(
        <Collapsible title="Title" defaultExpanded>
          <div data-testid="visible-content">Visible</div>
        </Collapsible>,
      );

      const content = screen.getByTestId('visible-content').parentElement;
      expect(content).toHaveAttribute('aria-hidden', 'false');
    });

    it('is focusable via tab', () => {
      render(
        <Collapsible title="Focusable Title">
          <div>Content</div>
        </Collapsible>,
      );

      const header = screen.getByRole('button');
      expect(header).toHaveAttribute('tabIndex', '0');
    });
  });

  describe('chevron icon', () => {
    it('rotates chevron when expanded', () => {
      render(
        <Collapsible title="Chevron Test" defaultExpanded>
          <div>Content</div>
        </Collapsible>,
      );

      const chevron = screen.getByRole('button').querySelector('svg');
      expect(chevron).toBeInTheDocument();
    });
  });
});
