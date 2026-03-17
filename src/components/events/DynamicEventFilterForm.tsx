/**
 * Dynamic Event Filter Form Component
 * Generates intelligent filter forms based on contract ABI
 */

import React, { useState, useCallback, useEffect } from 'react';
import { AbiEvent } from 'viem';
import DynamicFormGenerator from '../forms/DynamicFormGenerator';
import { FormData } from '../../types/forms';
import { generateSearchFilter } from '../../utils/form-validation';

interface DynamicEventFilterFormProps {
  contractAddress: string;
  abiEvents: AbiEvent[];
  onFilterChange: (filters: any) => void;
  onApplyFilters: (filters: any) => void;
  initialFilters?: any;
  disabled?: boolean;
  className?: string;
}

interface EventFilterState {
  selectedEvent: AbiEvent | null;
  formData: FormData;
  isAdvancedMode: boolean;
  filterCount: number;
}

/**
 * Dynamic event filter form that adapts to contract ABI
 */
export const DynamicEventFilterForm: React.FC<DynamicEventFilterFormProps> = ({
  contractAddress,
  abiEvents,
  onFilterChange,
  onApplyFilters,
  initialFilters = {},
  disabled = false,
  className = '',
}) => {
  /**
   * Count active filters
   */
  const countActiveFilters = useCallback((filters: any): number => {
    let count = 0;
    for (const [key, value] of Object.entries(filters)) {
      if (value !== null && value !== undefined && value !== '' && value !== false) {
        if (typeof value === 'object' && (value.from || value.to || value.like)) {
          count++;
        } else if (key !== 'eventName' || value !== '') {
          count++;
        }
      }
    }
    return count;
  }, []);

  const [state, setState] = useState<EventFilterState>({
    selectedEvent: null,
    formData: initialFilters,
    isAdvancedMode: false,
    filterCount: countActiveFilters(initialFilters),
  });

  /**
   * Handle event selection change
   */
  const handleEventChange = useCallback(
    (event: AbiEvent | null) => {
      setState(prev => ({
        ...prev,
        selectedEvent: event,
        formData: {
          ...prev.formData,
          eventName: event ? event.name : '',
        },
      }));

      if (event) {
        const filters = generateSearchFilter({
          ...state.formData,
          eventName: event.name,
        });
        onFilterChange(filters);
      }
    },
    [state.formData, onFilterChange],
  );

  /**
   * Handle form field changes
   */
  const handleFieldChange = useCallback(
    (fieldName: string, value: any) => {
      const newFormData = {
        ...state.formData,
        [fieldName]: value,
      };

      setState(prev => ({
        ...prev,
        formData: newFormData,
        filterCount: countActiveFilters(newFormData),
      }));

      // Generate and apply search filters in real-time
      const filters = generateSearchFilter(newFormData);
      onFilterChange(filters);
    },
    [state.formData, onFilterChange, countActiveFilters],
  );

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(
    (formData: FormData) => {
      const filters = generateSearchFilter(formData);
      onApplyFilters(filters);
    },
    [onApplyFilters],
  );

  /**
   * Toggle advanced mode
   */
  const toggleAdvancedMode = useCallback(() => {
    setState(prev => ({
      ...prev,
      isAdvancedMode: !prev.isAdvancedMode,
    }));
  }, []);

  /**
   * Clear all filters
   */
  const clearFilters = useCallback(() => {
    const clearedData: FormData = {};

    setState(prev => ({
      ...prev,
      formData: clearedData,
      filterCount: 0,
    }));

    onFilterChange({});
    onApplyFilters({});
  }, [onFilterChange, onApplyFilters]);

  /**
   * Quick filter presets
   */
  const applyPresetFilter = useCallback(
    (preset: string) => {
      let presetData: FormData = {};

      switch (preset) {
        case 'last-hour':
          const now = new Date();
          const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
          presetData = {
            timestampRange: {
              from: oneHourAgo.toISOString().slice(0, 16),
              to: now.toISOString().slice(0, 16),
            },
          };
          break;

        case 'last-24h':
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const today = new Date();
          presetData = {
            timestampRange: {
              from: yesterday.toISOString().slice(0, 16),
              to: today.toISOString().slice(0, 16),
            },
          };
          break;

        case 'large-values':
          presetData = {
            value: {
              from: '1000000000000000000', // 1 ETH
            },
          };
          break;

        case 'my-transactions':
          // This would need user's address context
          presetData = {};
          break;

        default:
          break;
      }

      setState(prev => ({
        ...prev,
        formData: { ...prev.formData, ...presetData },
        filterCount: countActiveFilters({ ...state.formData, ...presetData }),
      }));

      const filters = generateSearchFilter({ ...state.formData, ...presetData });
      onFilterChange(filters);
    },
    [state.formData, onFilterChange, countActiveFilters],
  );

  useEffect(() => {
    // Auto-select first event if available, but don't trigger filter
    if (abiEvents.length > 0 && !state.selectedEvent) {
      setState(prev => ({
        ...prev,
        selectedEvent: abiEvents[0],
        formData: {
          ...prev.formData,
          eventName: abiEvents[0].name,
        },
      }));
    }
  }, [abiEvents, state.selectedEvent]);

  return (
    <div className={`dynamic-event-filter-form ${className}`}>
      <div className="filter-header">
        <h3>Event Filters</h3>
        <div className="filter-actions">
          <span className="filter-count">
            {state.filterCount} {state.filterCount === 1 ? 'filter' : 'filters'} active
          </span>
          <button
            type="button"
            className="toggle-advanced"
            onClick={toggleAdvancedMode}
            disabled={disabled}
          >
            {state.isAdvancedMode ? 'Simple' : 'Advanced'}
          </button>
        </div>
      </div>

      {/* Event Type Selection */}
      {abiEvents.length > 1 && (
        <div className="event-selector">
          <label htmlFor="event-type-select">Event Type</label>
          <select
            id="event-type-select"
            value={state.selectedEvent?.name || ''}
            onChange={e => {
              const event = abiEvents.find(evt => evt.name === e.target.value) || null;
              handleEventChange(event);
            }}
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
      )}

      {/* Quick Presets */}
      <div className="quick-presets">
        <span className="presets-label">Quick filters:</span>
        <div className="preset-buttons">
          <button
            type="button"
            className="preset-button"
            onClick={() => applyPresetFilter('last-hour')}
            disabled={disabled}
          >
            Last Hour
          </button>
          <button
            type="button"
            className="preset-button"
            onClick={() => applyPresetFilter('last-24h')}
            disabled={disabled}
          >
            Last 24h
          </button>
          <button
            type="button"
            className="preset-button"
            onClick={() => applyPresetFilter('large-values')}
            disabled={disabled}
          >
            Large Values
          </button>
        </div>
      </div>

      {/* Dynamic Form Generator */}
      {state.selectedEvent && (
        <DynamicFormGenerator
          abiEvent={state.selectedEvent}
          initialData={state.formData}
          onSubmit={handleSubmit}
          onFieldChange={handleFieldChange}
          disabled={disabled}
          showAdvanced={state.isAdvancedMode}
        />
      )}

      {/* Filter Controls */}
      <div className="filter-controls">
        <button
          type="button"
          className="apply-filters-button"
          onClick={() => handleSubmit(state.formData)}
          disabled={disabled || state.filterCount === 0}
        >
          Apply Filters
        </button>
        <button
          type="button"
          className="clear-filters-button"
          onClick={clearFilters}
          disabled={disabled || state.filterCount === 0}
        >
          Clear All
        </button>
      </div>

      {/* Active Filters Display */}
      {state.filterCount > 0 && (
        <div className="active-filters">
          <h4>Active Filters:</h4>
          <div className="filter-tags">
            {Object.entries(state.formData).map(([key, value]) => {
              if (!value || value === '' || value === false) return null;

              const formatFilterValue = (k: string, v: any): string => {
                switch (k) {
                  case 'eventName':
                    return `Event: ${v}`;
                  case 'blockRange':
                    if (v.from && v.to) return `Blocks: ${v.from}-${v.to}`;
                    if (v.from) return `From Block: ${v.from}`;
                    if (v.to) return `To Block: ${v.to}`;
                    return '';
                  case 'timestampRange':
                    if (v.from && v.to)
                      return `Time: ${new Date(v.from).toLocaleDateString()} - ${new Date(v.to).toLocaleDateString()}`;
                    return '';
                  case 'value':
                    if (typeof v === 'object' && (v.from || v.to)) {
                      const parts = [];
                      if (v.from) parts.push(`≥${formatValue(v.from)}`);
                      if (v.to) parts.push(`≤${formatValue(v.to)}`);
                      return `Value: ${parts.join(' ')}`;
                    }
                    return `Value: ${formatValue(v)}`;
                  default:
                    if (typeof v === 'object' && v.like) {
                      return `${formatFieldName(k)}: ${v.like.replace(/%/g, '')}`;
                    }
                    return `${formatFieldName(k)}: ${formatValue(v)}`;
                }
              };

              function formatFieldName(name: string): string {
                return name
                  .split(/(?=[A-Z])/)
                  .join(' ')
                  .replace(/\b\w/g, l => l.toUpperCase());
              }

              const formatValue = (val: any): string => {
                if (typeof val === 'string' && val.startsWith('0x')) {
                  return `${val.slice(0, 6)}...${val.slice(-4)}`;
                }
                if (typeof val === 'number' && val !== null && val !== undefined) {
                  return Number(val).toLocaleString();
                }
                return String(val);
              };

              const displayValue = formatFilterValue(key, value);
              if (!displayValue) return null;

              return (
                <span key={key} className="filter-tag">
                  {displayValue}
                  <button
                    type="button"
                    className="remove-filter"
                    onClick={() => {
                      const newFormData = { ...state.formData };
                      delete newFormData[key];
                      setState(prev => ({
                        ...prev,
                        formData: newFormData,
                        filterCount: countActiveFilters(newFormData),
                      }));
                      const filters = generateSearchFilter(newFormData);
                      onFilterChange(filters);
                    }}
                    disabled={disabled}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default DynamicEventFilterForm;