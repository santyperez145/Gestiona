/**
 * useFormValidation — Lightweight form validation engine.
 *
 * Define rules per field, validate on submit or on-change, and get
 * per-field error messages. No external dependencies required.
 *
 * Usage:
 *   const { errors, validate, validateField, clearErrors, isValid } = useFormValidation({
 *     name: { required: true, minLength: 2 },
 *     email: { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
 *     price: { required: true, min: 0, max: 9_999_999 },
 *   });
 *
 *   // Validate all on submit
 *   const ok = validate({ name, email, price });
 *   if (!ok) return;
 *
 *   // Live validation on blur
 *   <Input onBlur={() => validateField("name", name)} />
 *   {errors.name && <p className="text-destructive text-xs">{errors.name}</p>}
 */
import { useState, useCallback } from "react";

type FieldValue = string | number | boolean | null | undefined;

interface FieldRules {
  /** Field is required */
  required?: boolean;
  /** Minimum string length (for strings) */
  minLength?: number;
  /** Maximum string length (for strings) */
  maxLength?: number;
  /** Minimum numeric value */
  min?: number;
  /** Maximum numeric value */
  max?: number;
  /** Regex pattern the string must match */
  pattern?: RegExp;
  /** Custom validator — return error message or null/undefined */
  custom?: (value: FieldValue) => string | null | undefined;
  /** Custom error message for 'required' failures */
  requiredMessage?: string;
  /** Custom error label used in auto messages */
  label?: string;
}

type Schema = Record<string, FieldRules>;
type Errors = Record<string, string | null>;
type Values = Record<string, FieldValue>;

function validateOne(key: string, value: FieldValue, rules: FieldRules): string | null {
  const label = rules.label ?? key;
  const str = value == null ? "" : String(value).trim();
  const num = typeof value === "number" ? value : parseFloat(str);

  if (rules.required && (value == null || str === "" || value === false)) {
    return rules.requiredMessage ?? `${label} es obligatorio`;
  }
  if (str !== "" && rules.minLength && str.length < rules.minLength) {
    return `${label} debe tener al menos ${rules.minLength} caracteres`;
  }
  if (str !== "" && rules.maxLength && str.length > rules.maxLength) {
    return `${label} no puede superar ${rules.maxLength} caracteres`;
  }
  if (str !== "" && !isNaN(num)) {
    if (rules.min !== undefined && num < rules.min) return `${label} debe ser ≥ ${rules.min}`;
    if (rules.max !== undefined && num > rules.max) return `${label} debe ser ≤ ${rules.max}`;
  }
  if (str !== "" && rules.pattern && !rules.pattern.test(str)) {
    return `${label} tiene un formato inválido`;
  }
  if (rules.custom) {
    const msg = rules.custom(value);
    if (msg) return msg;
  }
  return null;
}

interface UseFormValidationReturn {
  errors: Errors;
  /** Validate all fields. Returns true if no errors. */
  validate: (values: Values) => boolean;
  /** Validate a single field in-place. */
  validateField: (field: string, value: FieldValue) => boolean;
  /** Clear all errors or specific field error. */
  clearErrors: (field?: string) => void;
  /** True when there are no active errors. */
  isValid: boolean;
  /** Set an error manually (e.g. from server response). */
  setError: (field: string, message: string) => void;
}

export function useFormValidation(schema: Schema): UseFormValidationReturn {
  const [errors, setErrors] = useState<Errors>({});

  const validate = useCallback((values: Values): boolean => {
    const next: Errors = {};
    for (const [key, rules] of Object.entries(schema)) {
      const msg = validateOne(key, values[key], rules);
      next[key] = msg;
    }
    setErrors(next);
    return Object.values(next).every(e => !e);
  }, [schema]);

  const validateField = useCallback((field: string, value: FieldValue): boolean => {
    const rules = schema[field];
    if (!rules) return true;
    const msg = validateOne(field, value, rules);
    setErrors(prev => ({ ...prev, [field]: msg }));
    return !msg;
  }, [schema]);

  const clearErrors = useCallback((field?: string) => {
    if (field) {
      setErrors(prev => ({ ...prev, [field]: null }));
    } else {
      setErrors({});
    }
  }, []);

  const setError = useCallback((field: string, message: string) => {
    setErrors(prev => ({ ...prev, [field]: message }));
  }, []);

  const isValid = Object.values(errors).every(e => !e);

  return { errors, validate, validateField, clearErrors, isValid, setError };
}
