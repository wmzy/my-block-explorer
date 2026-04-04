/**
 * Form-related type definitions
 */

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'range' | 'datetime-range';
  required?: boolean;
  indexed?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  validation?: ValidationRule[];
  pattern?: RegExp;
  maxLength?: number;
  step?: string;
  min?: number;
  max?: number;
}

export interface ValidationRule {
  type:
    | 'required'
    | 'pattern'
    | 'min'
    | 'max'
    | 'range'
    | 'dateRange'
    | 'numeric'
    | 'array'
    | 'maxLength';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
  message: string;
  itemType?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FormData {
  [key: string]: any;
}

export interface FormState {
  values: FormData;
  errors: Record<string, string[]>;
  touched: Record<string, boolean>;
  isValid: boolean;
  isSubmitting: boolean;
}

export interface FormConfig {
  autoValidate?: boolean;
  validateOnBlur?: boolean;
  validateOnChange?: boolean;
  resetOnSubmit?: boolean;
}

export interface RangeValue {
  from?: string | number;
  to?: string | number;
}

export interface DateTimeRangeValue {
  from?: string;
  to?: string;
}
