/**
 * Dynamic Form Generator for ABI-based filtering
 * Creates intelligent form fields based on Solidity types and event parameters
 */

import React, { useState, useCallback, useMemo } from 'react';
import { AbiParameter, AbiEvent } from 'viem';
import { css } from '@linaria/core';
import { FormField, FormData, ValidationRule } from '../../types/forms';
import { validateSolidityInput, convertInputType } from '../../utils/form-validation';

interface DynamicFormGeneratorProps {
  abiEvent: AbiEvent;
  initialData?: FormData;
  onSubmit: (data: FormData) => void;
  onFieldChange?: (fieldName: string, value: any) => void;
  disabled?: boolean;
  showAdvanced?: boolean;
}

interface FormState {
  fields: Record<string, FormField>;
  values: FormData;
  errors: Record<string, string[]>;
  touched: Record<string, boolean>;
}

/**
 * Dynamic form generator based on Solidity types
 */
export const DynamicFormGenerator: React.FC<DynamicFormGeneratorProps> = ({
  abiEvent,
  initialData = {},
  onSubmit,
  onFieldChange,
  disabled = false,
  showAdvanced = false,
}) => {
  /**
   * Create a single form field from ABI parameter
   */
  const createFormField = (input: AbiParameter, index: number): FormField => {
    const solidityType = input.type;
    const fieldType = convertInputType(solidityType);

    const baseField: FormField = {
      name: input.name,
      label: formatFieldName(input.name),
      type: fieldType,
      required: false,
      indexed: input.indexed || false,
      placeholder: `Enter ${input.name}`,
      validation: generateValidationRules(solidityType),
    };

    // Add type-specific configurations
    switch (solidityType) {
      case 'address':
        baseField.placeholder = '0x...';
        baseField.pattern = /^0x[a-fA-F0-9]{40}$/;
        baseField.maxLength = 42;
        break;

      case 'uint256':
      case 'uint128':
      case 'uint64':
      case 'uint32':
        baseField.type = 'number';
        baseField.step = '1';
        baseField.placeholder = 'Enter amount (wei)';
        baseField.validation.push({
          type: 'min',
          value: 0,
          message: 'Value must be non-negative',
        });
        break;

      case 'int256':
      case 'int128':
        baseField.type = 'number';
        baseField.step = '1';
        break;

      case 'bool':
        baseField.type = 'checkbox';
        baseField.options = [
          { value: true, label: 'True' },
          { value: false, label: 'False' },
        ];
        break;

      case 'string':
        baseField.type = 'text';
        baseField.maxLength = 1000;
        break;

      case 'bytes':
      case 'bytes32':
        baseField.placeholder = '0x...';
        baseField.pattern = /^0x[a-fA-F0-9]*$/;
        break;

      default:
        if (solidityType.endsWith('[]')) {
          // Array types
          baseField.type = 'textarea';
          baseField.placeholder = 'Enter values (one per line)';
          baseField.validation.push({
            type: 'array',
            itemType: solidityType.slice(0, -2),
            message: 'Invalid array format',
          });
        }
        break;
    }

    return baseField;
  };

  /**
   * Generate form fields based on ABI parameters
   */
  const generateFormFields = useCallback((event: AbiEvent): Record<string, FormField> => {
    const fields: Record<string, FormField> = {};

    event.inputs.forEach((input, index) => {
      const field = createFormField(input, index);
      fields[input.name] = field;
    });

    // Add common filter fields
    fields.eventName = {
      name: 'eventName',
      label: 'Event Name',
      type: 'select',
      required: false,
      options: [
        { value: event.name, label: event.name },
        { value: '', label: 'All Events' },
      ],
      placeholder: 'Select event type',
      validation: [],
    };

    fields.blockRange = {
      name: 'blockRange',
      label: 'Block Range',
      type: 'range',
      required: false,
      placeholder: 'From block - To block',
      validation: [
        {
          type: 'range',
          min: 0,
          message: 'Invalid block range',
        },
      ],
    };

    fields.timestampRange = {
      name: 'timestampRange',
      label: 'Time Range',
      type: 'datetime-range',
      required: false,
      placeholder: 'From date - To date',
      validation: [
        {
          type: 'dateRange',
          message: 'Invalid date range',
        },
      ],
    };

    return fields;
  }, []);

  const [formState, setFormState] = useState<FormState>(() => {
    const fields = generateFormFields(abiEvent);
    const values = { ...initialData };
    const errors: Record<string, string[]> = {};
    const touched: Record<string, boolean> = {};

    // Initialize errors
    Object.keys(fields).forEach((fieldName) => {
      errors[fieldName] = [];
      touched[fieldName] = false;
    });

    return { fields, values, errors, touched };
  });

  /**
   * Generate validation rules for Solidity types
   */
  function generateValidationRules(solidityType: string): ValidationRule[] {
    const rules: ValidationRule[] = [];

    switch (solidityType) {
      case 'address':
        rules.push({
          type: 'pattern',
          value: /^0x[a-fA-F0-9]{40}$/,
          message: 'Invalid Ethereum address format',
        });
        break;

      case 'uint256':
      case 'uint128':
      case 'uint64':
      case 'uint32':
        rules.push({
          type: 'min',
          value: 0,
          message: 'Value must be non-negative',
        });
        break;

      case 'bytes32':
        rules.push({
          type: 'maxLength',
          value: 66,
          message: 'Bytes32 must be 66 characters (0x + 64 hex chars)',
        });
        break;

      default:
        if (solidityType.startsWith('uint') || solidityType.startsWith('int')) {
          rules.push({
            type: 'numeric',
            message: 'Must be a valid number',
          });
        }
        break;
    }

    return rules;
  }

  /**
   * Format field name for display
   */
  function formatFieldName(name: string): string {
    return name
      .split(/(?=[A-Z])/)
      .join(' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Handle field value changes
   */
  const handleFieldChange = useCallback(
    (fieldName: string, value: any) => {
      setFormState((prev) => {
        const newValues = { ...prev.values, [fieldName]: value };
        const newTouched = { ...prev.touched, [fieldName]: true };

        // Validate field
        const field = prev.fields[fieldName];
        const errors = validateSolidityInput(value, field.validation);
        const newErrors = { ...prev.errors, [fieldName]: errors };

        return {
          ...prev,
          values: newValues,
          touched: newTouched,
          errors: newErrors,
        };
      });

      // Notify parent
      onFieldChange?.(fieldName, value);
    },
    [onFieldChange],
  );

  /**
   * Validate entire form
   */
  const validateForm = useCallback((): boolean => {
    let isValid = true;
    const newErrors: Record<string, string[]> = {};

    Object.entries(formState.fields).forEach(([fieldName, field]) => {
      const value = formState.values[fieldName];
      const errors = validateSolidityInput(value, field.validation);

      newErrors[fieldName] = errors;
      if (errors.length > 0) {
        isValid = false;
      }
    });

    setFormState(prev => ({
      ...prev,
      errors: newErrors,
      touched: Object.keys(prev.fields).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
    }));

    return isValid;
  }, [formState.fields, formState.values]);

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (validateForm()) {
        onSubmit(formState.values);
      }
    },
    [formState.values, validateForm, onSubmit],
  );

  /**
   * Reset form to initial state
   */
  const handleReset = useCallback(() => {
    setFormState({
      fields: formState.fields,
      values: { ...initialData },
      errors: Object.keys(formState.fields).reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
      touched: Object.keys(formState.fields).reduce((acc, key) => ({ ...acc, [key]: false }), {}),
    });
  }, [formState.fields, initialData]);

  /**
   * Render individual form field
   */
  const renderField = useCallback(
    (fieldName: string, field: FormField) => {
      const value = formState.values[fieldName];
      const errors = formState.errors[fieldName];
      const touched = formState.touched[fieldName];
      const hasError = touched && errors.length > 0;

      const fieldClassName = `form-field ${hasError ? 'error' : ''} ${field.indexed ? 'indexed' : ''}`;

      switch (field.type) {
        case 'text':
        case 'number':
          return (
            <div key={fieldName} className={fieldClassName}>
              <label htmlFor={fieldName}>
                {field.label}
                {field.indexed && <span className="indexed-badge">Indexed</span>}
                {field.required && <span className="required">*</span>}
              </label>
              <input
                id={fieldName}
                type={field.type}
                value={value || ''}
                onChange={e => handleFieldChange(fieldName, e.target.value)}
                placeholder={field.placeholder}
                disabled={disabled}
                pattern={field.pattern}
                maxLength={field.maxLength}
                step={field.step}
                min={field.min}
                max={field.max}
              />
              {hasError && (
                <div className="error-messages">
                  {errors.map((error, index) => (
                    <span key={index} className="error-message">
                      {error}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );

        case 'select':
          return (
            <div key={fieldName} className={fieldClassName}>
              <label htmlFor={fieldName}>
                {field.label}
                {field.required && <span className="required">*</span>}
              </label>
              <select
                id={fieldName}
                value={value || ''}
                onChange={e => handleFieldChange(fieldName, e.target.value)}
                disabled={disabled}
              >
                {field.options?.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {hasError && (
                <div className="error-messages">
                  {errors.map((error, index) => (
                    <span key={index} className="error-message">
                      {error}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );

        case 'checkbox':
          return (
            <div key={fieldName} className={fieldClassName}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={e => handleFieldChange(fieldName, e.target.checked)}
                  disabled={disabled}
                />
                {field.label}
                {field.indexed && <span className="indexed-badge">Indexed</span>}
              </label>
              {hasError && (
                <div className="error-messages">
                  {errors.map((error, index) => (
                    <span key={index} className="error-message">
                      {error}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );

        case 'textarea':
          return (
            <div key={fieldName} className={fieldClassName}>
              <label htmlFor={fieldName}>
                {field.label}
                {field.required && <span className="required">*</span>}
              </label>
              <textarea
                id={fieldName}
                value={value || ''}
                onChange={e => handleFieldChange(fieldName, e.target.value)}
                placeholder={field.placeholder}
                disabled={disabled}
                maxLength={field.maxLength}
                rows={4}
              />
              {hasError && (
                <div className="error-messages">
                  {errors.map((error, index) => (
                    <span key={index} className="error-message">
                      {error}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );

        case 'range':
          return (
            <div key={fieldName} className={fieldClassName}>
              <label>{field.label}</label>
              <div className="range-inputs">
                <input
                  type="number"
                  placeholder="From"
                  value={value?.from || ''}
                  onChange={e => handleFieldChange(fieldName, { ...value, from: e.target.value })}
                  disabled={disabled}
                  min="0"
                />
                <span>to</span>
                <input
                  type="number"
                  placeholder="To"
                  value={value?.to || ''}
                  onChange={e => handleFieldChange(fieldName, { ...value, to: e.target.value })}
                  disabled={disabled}
                  min="0"
                />
              </div>
              {hasError && (
                <div className="error-messages">
                  {errors.map((error, index) => (
                    <span key={index} className="error-message">
                      {error}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );

        case 'datetime-range':
          return (
            <div key={fieldName} className={fieldClassName}>
              <label>{field.label}</label>
              <div className="datetime-inputs">
                <input
                  type="datetime-local"
                  placeholder="From"
                  value={value?.from || ''}
                  onChange={e => handleFieldChange(fieldName, { ...value, from: e.target.value })}
                  disabled={disabled}
                />
                <span>to</span>
                <input
                  type="datetime-local"
                  placeholder="To"
                  value={value?.to || ''}
                  onChange={e => handleFieldChange(fieldName, { ...value, to: e.target.value })}
                  disabled={disabled}
                />
              </div>
              {hasError && (
                <div className="error-messages">
                  {errors.map((error, index) => (
                    <span key={index} className="error-message">
                      {error}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );

        default:
          return null;
      }
    },
    [formState.values, formState.errors, formState.touched, disabled, handleFieldChange],
  );

  const visibleFields = useMemo(() => {
    const fields = Object.entries(formState.fields);

    if (!showAdvanced) {
      // Hide advanced fields
      return fields.filter(([_, field]) => !['blockRange', 'timestampRange'].includes(field.name));
    }

    return fields;
  }, [formState.fields, showAdvanced]);

  const formHasErrors = useMemo(() => {
    return Object.values(formState.errors).some(errors => errors.length > 0);
  }, [formState.errors]);

  return (
    <form className={formStyles} onSubmit={handleSubmit} noValidate>
      <div className="form-header">
        <h3>Filter Events</h3>
        <div className="form-actions">
          <button
            type="button"
            className="toggle-advanced"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
          </button>
          <button type="button" className="reset-form" onClick={handleReset} disabled={disabled}>
            Reset
          </button>
        </div>
      </div>

      <div className="form-fields">
        {visibleFields.map(([fieldName, field]) => renderField(fieldName, field))}
      </div>

      <div className="form-footer">
        <button type="submit" className="submit-button" disabled={disabled || formHasErrors}>
          Apply Filters
        </button>
        {formHasErrors && (
          <div className="form-errors">Please correct the errors before submitting.</div>
        )}
      </div>
    </form>
  );
};

const formStyles = css`
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;

  .form-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;

    h3 {
      margin: 0;
      color: #333;
    }
  }

  .form-actions {
    display: flex;
    gap: 10px;
  }

  .toggle-advanced,
  .reset-form {
    padding: 6px 12px;
    background: #e9ecef;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .form-fields {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;

    &.error input,
    &.error select,
    &.error textarea {
      border-color: #dc3545;
    }

    label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
      color: #495057;
    }

    input,
    select,
    textarea {
      padding: 8px 12px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 14px;

      &:focus {
        outline: none;
        border-color: #80bdff;
        box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
      }
    }
  }

  .indexed-badge {
    background: #007bff;
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: normal;
  }

  .required {
    color: #dc3545;
  }

  .range-inputs,
  .datetime-inputs {
    display: flex;
    align-items: center;
    gap: 8px;

    input {
      flex: 1;
    }

    span {
      color: #6c757d;
    }
  }

  .checkbox-label {
    display: flex !important;
    align-items: center;
    gap: 8px;
    flex-direction: row !important;
  }

  .error-messages {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .error-message {
    color: #dc3545;
    font-size: 12px;
  }

  .form-footer {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid #dee2e6;
  }

  .submit-button {
    width: 100%;
    padding: 12px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: #0056b3;
    }

    &:disabled {
      background: #6c757d;
      cursor: not-allowed;
    }
  }

  .form-errors {
    margin-top: 8px;
    color: #dc3545;
    font-size: 14px;
    text-align: center;
  }
`;

export default DynamicFormGenerator;
