import React, { useEffect, useState } from 'react';
import { Input, type InputProps } from '@/components/ui/input';

interface NumberInputProps extends Omit<InputProps, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> {
  // Text or a number; an empty value, 0 or null shows an empty field
  value: string | number | null | undefined;
  // Receives the typed text ('' when cleared); parse it with Number() or parseFloat()
  onValueChange: (value: string) => void;
  // Digits allowed after the decimal point; 0 accepts whole numbers only
  decimals?: number;
}

const toText = (value: NumberInputProps['value']) =>
  value === null || value === undefined || value === 0 ? '' : String(value);

// Text field that accepts only a non-negative number. Unlike type="number" it starts empty instead of 0,
// can be cleared freely, and the mouse wheel cannot change it.
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onValueChange, decimals = 2, ...props }, ref) => {
    const pattern = decimals > 0 ? new RegExp(`^\\d*(\\.\\d{0,${decimals}})?$`) : /^\d*$/;
    // The typed text, so "12." or an empty field survive a parent that stores numbers
    const [draft, setDraft] = useState(() => toText(value));

    useEffect(() => {
      setDraft((current) => (Number(current || 0) === Number(value || 0) ? current : toText(value)));
    }, [value]);

    return (
      <Input
        ref={ref}
        type="text"
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={draft}
        onChange={(event) => {
          const next = event.target.value.trim();
          if (!pattern.test(next)) return;
          setDraft(next);
          onValueChange(next);
        }}
        {...props}
      />
    );
  },
);
NumberInput.displayName = 'NumberInput';
