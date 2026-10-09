import React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  // Span both columns of a two-column form
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
}

// One input in edit and create modes; same label style as DetailField
export const FormField = ({ label, htmlFor, required = false, error, hint, wide = false, className, children }: FormFieldProps) => (
  <div className={cn('space-y-2', wide && 'sm:col-span-2', className)}>
    <Label htmlFor={htmlFor} className="text-sm font-medium text-gray-600">
      {label}
      {required && ' *'}
    </Label>
    {children}
    {hint && !error && <p className="text-sm text-gray-500">{hint}</p>}
    {error && <p className="text-sm text-red-600">{error}</p>}
  </div>
);
