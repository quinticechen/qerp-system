
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, AlertCircle } from 'lucide-react';

interface StockAlertBadgeProps {
  currentStock: number;
  threshold: number | null;
  className?: string;
}

export const StockAlertBadge: React.FC<StockAlertBadgeProps> = ({
  currentStock,
  threshold,
  className = '',
}) => {
  if (!threshold || currentStock > threshold) {
    return (
      <div className={`text-right ${className}`}>
        <span className="text-gray-900 font-medium">{currentStock.toFixed(2)} KG</span>
      </div>
    );
  }

  const isCritical = currentStock <= threshold * 0.5;
  const isWarning = currentStock <= threshold && currentStock > threshold * 0.5;

  if (isCritical) {
    return (
      <div className={`text-right ${className}`}>
        <div className="flex items-center justify-end space-x-1">
          <AlertCircle size={16} className="text-red-600" />
          <span className="text-red-600 font-medium">{currentStock.toFixed(2)} KG</span>
        </div>
        <Badge variant="destructive" className="text-xs mt-1">
          嚴重不足
        </Badge>
      </div>
    );
  }

  if (isWarning) {
    return (
      <div className={`text-right ${className}`}>
        <div className="flex items-center justify-end space-x-1">
          <AlertTriangle size={16} className="text-orange-600" />
          <span className="text-orange-600 font-medium">{currentStock.toFixed(2)} KG</span>
        </div>
        <Badge variant="secondary" className="text-xs mt-1 bg-orange-100 text-orange-800">
          庫存不足
        </Badge>
      </div>
    );
  }

  return (
    <div className={`text-right ${className}`}>
      <span className="text-gray-900 font-medium">{currentStock.toFixed(2)} KG</span>
    </div>
  );
};
