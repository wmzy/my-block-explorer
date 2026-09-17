import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { toast } from 'sonner';
import { get, post } from '@/util/http';

type DetectedIde = {
  id: string;
  displayName: string;
};

// "Open in IDE" action: detected IDEs come from the backend, opening fires
// the write-side POST. Zero IDEs (or a failed detection) renders nothing —
// the action is impossible without a local IDE, and honest absence beats a
// permanently disabled button; one renders a direct action, several a
// dropdown.
export function OpenInIdeButton({ chainId, address }: { chainId: number; address: string }) {
  const [detectedIdes, setDetectedIdes] = useState<DetectedIde[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    get<{ ides?: DetectedIde[] }>(`/api/chains/${chainId}/contracts/${address}/ides`)
      .then(data => setDetectedIdes(data.ides ?? []))
      .catch(() => setDetectedIdes([]));
  }, [chainId, address]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const handleOpen = useCallback(
    async (ideId: string) => {
      setDropdownOpen(false);
      setOpening(true);
      setOpened(false);

      try {
        await post(`/api/chains/${chainId}/contracts/${address}/open-in-ide`, { ide: ideId });
        setOpened(true);
        setTimeout(() => setOpened(false), 2000);
      } catch (error) {
        // Remote users hit this when no local IDE bridge answers: surface
        // the failure instead of swallowing it.
        toast.error(
          error instanceof Error && error.message
            ? `Failed to open in IDE: ${error.message}`
            : 'Failed to open in IDE. Please check that your IDE is running.',
        );
      } finally {
        setOpening(false);
      }
    },
    [chainId, address],
  );

  const baseBtnStyle: CSSProperties = {
    padding: '6px 12px',
    background: 'white',
    color: '#333',
    border: '1px solid #d0d5dd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  };

  if (detectedIdes.length === 0) {
    return null;
  }

  if (detectedIdes.length === 1) {
    return (
      <button
        style={{
          ...baseBtnStyle,
          ...(opened ? { color: '#16a34a', borderColor: '#16a34a', background: '#f0fdf4' } : {}),
        }}
        onClick={() => handleOpen(detectedIdes[0].id)}
        disabled={opening}
      >
        {opening ? 'Opening...' : opened ? 'Opened!' : `Open in ${detectedIdes[0].displayName}`}
      </button>
    );
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        style={{
          ...baseBtnStyle,
          ...(opened ? { color: '#16a34a', borderColor: '#16a34a', background: '#f0fdf4' } : {}),
        }}
        onClick={() => setDropdownOpen(prev => !prev)}
        disabled={opening}
      >
        {opening ? 'Opening...' : opened ? 'Opened!' : 'Open in IDE ▾'}
      </button>
      {dropdownOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '4px',
            background: 'white',
            border: '1px solid #d0d5dd',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
            minWidth: '140px',
            zIndex: 10,
            overflow: 'hidden',
          }}
        >
          {detectedIdes.map(ide => (
            <button
              key={ide.id}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                color: '#333',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid #e8ecef',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
              onMouseOver={e => ((e.target as HTMLElement).style.background = '#f0f4f8')}
              onMouseOut={e => ((e.target as HTMLElement).style.background = 'none')}
              onClick={() => handleOpen(ide.id)}
            >
              {ide.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
