import React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { PartnerKind } from '@/lib/api/partners';
import { partnerFieldDefs, type PartnerFieldKey, type PartnerForm } from '@/lib/partnerForm';
import { FormField } from './FormField';

interface PartnerFormFieldsProps {
  kind: PartnerKind;
  form: PartnerForm;
  errors: Partial<Record<PartnerFieldKey, string>>;
  onChange: (key: PartnerFieldKey, value: string) => void;
}

// The customer or factory form, shared by creating and editing
export const PartnerFormFields = ({ kind, form, errors, onChange }: PartnerFormFieldsProps) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {partnerFieldDefs(kind).map((field) => {
      const id = `${kind}-${field.key}`;
      return (
        <FormField
          key={field.key}
          label={field.label}
          htmlFor={id}
          required={field.required}
          error={errors[field.key]}
          wide={field.type === 'textarea'}
        >
          {field.type === 'textarea' ? (
            <Textarea
              id={id}
              value={form[field.key]}
              onChange={(e) => onChange(field.key, e.target.value)}
              rows={3}
              className={errors[field.key] ? 'border-destructive' : undefined}
            />
          ) : (
            <Input
              id={id}
              type={field.type}
              value={form[field.key]}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className={errors[field.key] ? 'border-destructive' : undefined}
            />
          )}
        </FormField>
      );
    })}
  </div>
);
