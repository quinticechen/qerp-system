import React from 'react';
import { cn } from '@/lib/utils';
import { SHOW_UNFINISHED_FEATURES } from '@/lib/appEnvironment';

interface UnfinishedFeatureProps {
  children: React.ReactNode;
  // Layout classes for the wrapper, e.g. a grid span the wrapped card used to have
  className?: string;
  // block (default): cards and sections, labelled in the corner; inline: a short value or line of text
  variant?: 'block' | 'inline';
}

// Wrap any UI whose feature is not implemented yet (CLAUDE.md「尚未實作的功能」): production users never see it;
// local and staging show it greyed out, labelled and disabled so it can still be reviewed
export const UnfinishedFeature = ({ children, className, variant = 'block' }: UnfinishedFeatureProps) => {
  if (!SHOW_UNFINISHED_FEATURES) return null;

  if (variant === 'inline') {
    return (
      <span
        className={cn('inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 [&>*]:text-gray-400', className)}
        data-unfinished-feature=""
        title="尚未實作"
      >
        {children}
        <span className="text-xs text-gray-500">尚未實作</span>
      </span>
    );
  }

  return (
    <div className={cn('relative', className)} data-unfinished-feature="">
      <span className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-gray-500 px-2 py-0.5 text-xs font-medium text-white">
        尚未實作
      </span>
      <fieldset
        disabled
        aria-label="尚未實作的功能"
        className="h-full [&>*]:h-full [&>*]:border-dashed [&>*]:border-gray-300 [&>*]:bg-gray-100 [&>*]:text-gray-500"
      >
        {children}
      </fieldset>
    </div>
  );
};
