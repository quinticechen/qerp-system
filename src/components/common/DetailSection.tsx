import React from 'react';
import { cn } from '@/lib/utils';

interface DetailSectionProps {
  title?: React.ReactNode;
  // Lay the children out as a two-column list of DetailField
  fields?: boolean;
  className?: string;
  children: React.ReactNode;
}

// A titled block inside a RecordDialog; the same heading size in view, edit and create modes
export const DetailSection = ({ title, fields = false, className, children }: DetailSectionProps) => (
  <section className={cn('space-y-3', className)}>
    {title && <h3 className="text-base font-semibold text-gray-900">{title}</h3>}
    {fields ? <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</dl> : children}
  </section>
);
