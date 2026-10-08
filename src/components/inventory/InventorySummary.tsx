
import React from 'react';
import { EnhancedInventorySummary } from './EnhancedInventorySummary';

export const InventorySummary = ({ readOnly = false }: { readOnly?: boolean }) => {
  return <EnhancedInventorySummary readOnly={readOnly} />;
};
