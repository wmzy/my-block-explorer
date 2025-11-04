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
  const [state, setState] = useState<EventFilterState>({
    selectedEvent: null,
    formData: initialFilters,
    isAdvancedMode: false,
    filterCount: countActiveFilters(initialFilters),
  });

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

  /**
   * Handle event selection change
   */
  const handleEventChange = useCallback((event: AbiEvent | null) => {
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
  }, [state.formData, onFilterChange]);

  /**
   * Handle form field changes
   */
  const handleFieldChange = useCallback((fieldName: string, value: any) => {
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
  }, [state.formData, onFilterChange, countActiveFilters]);

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback((formData: FormData) => {
    const filters = generateSearchFilter(formData);
    onApplyFilters(filters);
  }, [onApplyFilters]);

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
  const applyPresetFilter = useCallback((preset: string) => {
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
  }, [state.formData, onFilterChange, countActiveFilters]);

  useEffect(() => {
    // Auto-select first event if available
    if (abiEvents.length > 0 && !state.selectedEvent) {
      handleEventChange(abiEvents[0]);
    }
  }, [abiEvents, state.selectedEvent, handleEventChange]);

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
            onChange={(e) => {
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
                    if (v.from && v.to) return `Time: ${new Date(v.from).toLocaleDateString()} - ${new Date(v.to).toLocaleDateString()}`;
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

              const formatFieldName = (name: string): string => {
                return name
                  .split(/(?=[A-Z])/)
                  .join(' ')
                  .replace(/\b\w/g, l => l.toUpperCase());
              };

              const formatValue = (val: any): string => {
                if (typeof val === 'string' && val.startsWith('0x')) {
                  return `${val.slice(0, 6)}...${val.slice(-4)}`;
                }
                if (typeof val === 'number') {
                  return val.toLocaleString();
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

      <style jsx>{`
        .dynamic-event-filter-form {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .filter-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 12px;
          border-bottom: 1px solid #e9ecef;
        }

        .filter-header h3 {
          margin: 0;
          color: #333;
          font-size: 18px;
        }

        .filter-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .filter-count {
          font-size: 14px;
          color: #6c757d;
        }

        .toggle-advanced {
          padding: 6px 12px;
          background: #f8f9fa;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: background-color 0.2s;
        }

        .toggle-advanced:hover:not(:disabled) {
          background: #e9ecef;
        }

        .event-selector {
          margin-bottom: 16px;
        }

        .event-selector label {
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: #495057;
        }

        .event-selector select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ced4da;
          border-radius: 4px;
          font-size: 14px;
        }

        .quick-presets {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
          padding: 12px;
          background: #f8f9fa;
          border-radius: 6px;
        }

        .presets-label {
          font-size: 14px;
          color: #6c757d;
          font-weight: 500;
        }

        .preset-buttons {
          display: flex;
          gap: 8px;
        }

        .preset-button {
          padding: 4px 8px;
          background: white;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .preset-button:hover:not(:disabled) {
          background: #007bff;
          color: white;
          border-color: #007bff;
        }

        .filter-controls {
          display: flex;
          gap: 12px;
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #e9ecef;
        }

        .apply-filters-button {
          flex: 1;
          padding: 10px 16px;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .apply-filters-button:hover:not(:disabled) {
          background: #0056b3;
        }

        .apply-filters-button:disabled {
          background: #6c757d;
          cursor: not-allowed;
        }

        .clear-filters-button {
          padding: 10px 16px;
          background: #6c757d;
          color: white;
          border: none;
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .clear-filters-button:hover:not(:disabled) {
          background: #545b62;
        }

        .clear-filters-button:disabled {
          background: #adb5bd;
          cursor: not-allowed;
        }

        .active-filters {
          margin-top: 16px;
          padding: 12px;
          background: #f8f9fa;
          border-radius: 6px;
        }

        .active-filters h4 {
          margin: 0 0 8px 0;
          font-size: 14px;
          color: #495057;
        }

        .filter-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .filter-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          background: #007bff;
          color: white;
          border-radius: 12px;
          font-size: 12px;
        }

        .remove-filter {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          padding: 0;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.2s;
        }

        .remove-filter:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.2);
        }

        @media (max-width: 768px) {
          .quick-presets {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }

          .preset-buttons {
            flex-wrap: wrap;
          }

          .filter-controls {
            flex-direction: column;
          }

          .filter-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }
        }
      `}</style>
    </div>
  );
};

export default DynamicEventFilterForm;