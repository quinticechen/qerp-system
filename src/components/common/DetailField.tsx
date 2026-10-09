import React from 'react';
import { cn } from '@/lib/utils';

interface DetailFieldProps {
  label: string;
  // Empty text, null or undefined shows「-」, so every field is listed even when it is not filled in
  children?: React.ReactNode;
  // Span both columns (long text such as an address or note)
  wide?: boolean;
  className?: string;
}

const isEmpty = (value: React.ReactNode) => value === null || value === undefined || value === '';

// One read-only value in view mode; same label style as FormField so view and edit line up
export const DetailField = ({ label, children, wide = false, className }: DetailFieldProps) => (
  <div className={cn('space-y-1', wide && 'sm:col-span-2', className)}>
    <dt className="text-sm font-medium text-gray-600">{label}</dt>
    <dd className="whitespace-pre-wrap break-words text-sm text-gray-900">{isEmpty(children) ? '-' : children}</dd>
  </div>
);
