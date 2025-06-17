
import React from 'react';
import { Badge } from '@/components/ui/badge';

interface StockBadgeProps {
  currentStock: number;
  threshold?: number | null;
  type?: 'stock' | 'pending-in' | 'pending-out';
  className?: string;
}

export const StockBadge: React.FC<StockBadgeProps> = ({
  currentStock,
  threshold,
  type = 'stock',
  className = '',
}) => {
  const getStockBadgeStyle = () => {
    if (type === 'pending-in') {
      return 'bg-blue-100 text-blue-800 border-blue-200';
    }
    
    if (type === 'pending-out') {
      return 'bg-orange-100 text-orange-800 border-orange-200';
    }
    
    // 庫存警報邏輯
    if (!threshold) return 'bg-gray-100 text-gray-800';
    
    if (currentStock > threshold) return 'bg-green-100 text-green-800';
    if (currentStock === threshold) return 'bg-yellow-100 text-yellow-800';
    if (currentStock < threshold) return 'bg-red-100 text-red-800';
    
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <Badge 
      variant="outline" 
      className={`${getStockBadgeStyle()} ${className}`}
    >
      {currentStock.toFixed(2)} KG
    </Badge>
  );
};
