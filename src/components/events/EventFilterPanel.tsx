import { css, cx } from '@linaria/core';
import type { AbiEvent } from 'viem';
import { useState, useCallback, useMemo } from 'react';
import { Collapsible } from '@/components/ui/Collapsible';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export type EventFilterState = {
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  abiFilters?: Record<string, string>;
};

type EventFilterPanelProps = {
  abiEvents: AbiEvent[];
  initialFilters?: EventFilterState;
  onApply: (filters: EventFilterState) => void;
  onFiltersChange?: (filters: EventFilterState) => void;
  disabled?: boolean;
};

const containerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-4);
`;

const rowStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
`;

const fieldGroupStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
`;

const labelStyle = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  color: var(--haze-color-text-secondary);
`;

const inputStyle = css`
  padding: var(--haze-space-2) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  font-size: var(--haze-text-sm);
  font-family: var(--haze-font-mono);
  background: var(--haze-color-bg-subtle);
  color: var(--haze-color-text);
  min-width: 120px;
  transition: border-color 150ms ease;

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const selectStyle = css`
  padding: var(--haze-space-2) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  font-size: var(--haze-text-sm);
  font-family: var(--haze-font-mono);
  background: var(--haze-color-bg-subtle);
  color: var(--haze-color-text);
  min-width: 120px;
  transition: border-color 150ms ease;
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const buttonGroupStyle = css`
  display: flex;
  gap: var(--haze-space-2);
  margin-left: auto;
`;

const dynamicFieldsRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
  padding-top: var(--haze-space-3);
  border-top: 1px solid var(--haze-color-border);
`;

const indexedDot = css`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--haze-color-primary);
  margin-left: var(--haze-space-1);
  vertical-align: middle;
`;

export function EventFilterPanel({
  abiEvents,
  initialFilters = {},
  onApply,
  onFiltersChange,
  disabled = false,
}: EventFilterPanelProps) {
  const [eventName, setEventName] = useState<string>(initialFilters.eventName ?? '');
  const [fromBlock, setFromBlock] = useState<string>(initialFilters.fromBlock?.toString() ?? '');
  const [toBlock, setToBlock] = useState<string>(initialFilters.toBlock?.toString() ?? '');
  const [abiFilters, setAbiFilters] = useState<Record<string, string>>(
    initialFilters.abiFilters ?? {},
  );

  const selectedEvent = useMemo(() => {
    return abiEvents.find(e => e.name === eventName);
  }, [abiEvents, eventName]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (eventName) count++;
    if (fromBlock) count++;
    if (toBlock) count++;
    count += Object.values(abiFilters).filter(v => v !== '').length;
    return count;
  }, [eventName, fromBlock, toBlock, abiFilters]);

  const handleApply = useCallback(() => {
    const filters: EventFilterState = {
      eventName: eventName || undefined,
      fromBlock: fromBlock ? parseInt(fromBlock, 10) : undefined,
      toBlock: toBlock ? parseInt(toBlock, 10) : undefined,
      abiFilters: Object.keys(abiFilters).length > 0 ? abiFilters : undefined,
    };
    onApply(filters);
  }, [eventName, fromBlock, toBlock, abiFilters, onApply]);

  const handleClear = useCallback(() => {
    setEventName('');
    setFromBlock('');
    setToBlock('');
    setAbiFilters({});
    onApply({});
    onFiltersChange?.({});
  }, [onApply, onFiltersChange]);

  const handleEventChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setEventName(value);
      onFiltersChange?.({
        eventName: value || undefined,
        fromBlock: fromBlock ? parseInt(fromBlock, 10) : undefined,
        toBlock: toBlock ? parseInt(toBlock, 10) : undefined,
      });
    },
    [fromBlock, toBlock, onFiltersChange],
  );

  const handleFromBlockChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setFromBlock(value);
      onFiltersChange?.({
        eventName: eventName || undefined,
        fromBlock: value ? parseInt(value, 10) : undefined,
        toBlock: toBlock ? parseInt(toBlock, 10) : undefined,
      });
    },
    [eventName, toBlock, onFiltersChange],
  );

  const handleToBlockChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setToBlock(value);
      onFiltersChange?.({
        eventName: eventName || undefined,
        fromBlock: fromBlock ? parseInt(fromBlock, 10) : undefined,
        toBlock: value ? parseInt(value, 10) : undefined,
      });
    },
    [eventName, fromBlock, onFiltersChange],
  );

  const handleAbiFilterChange = useCallback(
    (paramName: string, value: string) => {
      setAbiFilters(prev => {
        const updated = { ...prev };
        if (value === '') {
          delete updated[paramName];
        } else {
          updated[paramName] = value;
        }
        return updated;
      });
      onFiltersChange?.({
        eventName: eventName || undefined,
        fromBlock: fromBlock ? parseInt(fromBlock, 10) : undefined,
        toBlock: toBlock ? parseInt(toBlock, 10) : undefined,
        abiFilters: {
          ...abiFilters,
          [paramName]: value,
        },
      });
    },
    [eventName, fromBlock, toBlock, abiFilters, onFiltersChange],
  );

  const renderAbiField = (input: AbiEvent['inputs'][number]) => {
    if (!input.name || input.type.endsWith('[]')) return null;

    const name: string = input.name;
    const value = abiFilters[name] ?? '';
    const isIndexed = input.indexed ?? false;

    if (input.type === 'bool') {
      return (
        <div key={name} className={fieldGroupStyle}>
          <label htmlFor={`abi-filter-${name}`} className={labelStyle}>
            {name}
            {isIndexed && <span className={indexedDot} />}
            <span
              style={{
                fontSize: 'var(--haze-text-xs)',
                marginLeft: 'var(--haze-space-1)',
                opacity: 0.7,
              }}
            >
              {input.type}
            </span>
          </label>
          <select
            id={`abi-filter-${name}`}
            className={selectStyle}
            value={value}
            onChange={e => handleAbiFilterChange(name, e.target.value)}
            disabled={disabled}
          >
            <option value="">all</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
      );
    }

    const isNumeric = /^u?int\d*$/.test(input.type);
    const isAddress = input.type === 'address';
    const isBytes = /^bytes\d*$/.test(input.type);

    const placeholder = isAddress || isBytes ? '0x...' : '';

    return (
      <div key={name} className={fieldGroupStyle}>
        <label htmlFor={`abi-filter-${name}`} className={labelStyle}>
          {name}
          {isIndexed && <span className={indexedDot} />}
          <span
            style={{
              fontSize: 'var(--haze-text-xs)',
              marginLeft: 'var(--haze-space-1)',
              opacity: 0.7,
            }}
          >
            {input.type}
          </span>
        </label>
        <input
          id={`abi-filter-${name}`}
          type={isNumeric ? 'number' : 'text'}
          className={inputStyle}
          value={value}
          onChange={e => handleAbiFilterChange(name, e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      </div>
    );
  };

  return (
    <Collapsible
      title="Event Filters"
      defaultExpanded={true}
      badge={
        activeFilterCount > 0 ? (
          <Badge variant="info" size="sm">
            {activeFilterCount}
          </Badge>
        ) : undefined
      }
    >
      <div className={containerStyle}>
        <div className={rowStyle}>
          <div className={fieldGroupStyle}>
            <label htmlFor="event-name" className={labelStyle}>
              Event Type
            </label>
            <select
              id="event-name"
              className={selectStyle}
              value={eventName}
              onChange={handleEventChange}
              disabled={disabled}
            >
              <option value="">All Events</option>
              {abiEvents.map(event => (
                <option key={event.name} value={event.name}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>

          <div className={fieldGroupStyle}>
            <label htmlFor="from-block" className={labelStyle}>
              From Block
            </label>
            <input
              id="from-block"
              type="number"
              className={inputStyle}
              value={fromBlock}
              onChange={handleFromBlockChange}
              placeholder="Start block"
              disabled={disabled}
              min="0"
            />
          </div>

          <div className={fieldGroupStyle}>
            <label htmlFor="to-block" className={labelStyle}>
              To Block
            </label>
            <input
              id="to-block"
              type="number"
              className={inputStyle}
              value={toBlock}
              onChange={handleToBlockChange}
              placeholder="End block"
              disabled={disabled}
              min="0"
            />
          </div>

          <div className={cx(fieldGroupStyle, buttonGroupStyle)}>
            <label className={labelStyle}>&nbsp;</label>
            <Button variant="primary" size="sm" onClick={handleApply} disabled={disabled}>
              Apply
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={disabled || activeFilterCount === 0}
            >
              Clear
            </Button>
          </div>
        </div>

        {selectedEvent && selectedEvent.inputs.length > 0 && (
          <div className={dynamicFieldsRow}>
            {selectedEvent.inputs.filter(input => !input.type.endsWith('[]')).map(renderAbiField)}
          </div>
        )}
      </div>
    </Collapsible>
  );
}
