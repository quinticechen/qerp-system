
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';

interface LowStockProduct {
  product_id: string;
  product_name: string;
  color: string | null;
  current_stock: number;
  threshold: number;
}

interface StockAlertNotificationProps {
  lowStockProducts: LowStockProduct[];
}

export const StockAlertNotification: React.FC<StockAlertNotificationProps> = ({
  lowStockProducts
}) => {
  if (lowStockProducts.length === 0) {
    return null;
  }

  return (
    <Alert className="border-orange-200 bg-orange-50">
      <AlertTriangle className="h-4 w-4 text-orange-600" />
      <AlertTitle className="text-orange-800">庫存不足警告</AlertTitle>
      <AlertDescription className="text-orange-700">
        <div className="mt-2 space-y-2">
          <p>以下產品庫存量已低於預警閾值：</p>
          <div className="space-y-1">
            {lowStockProducts.map((product, index) => (
              <div key={`${product.product_id}-${product.color || 'no-color'}`} className="flex items-center justify-between bg-white p-2 rounded border border-orange-200">
                <div>
                  <span className="font-medium">
                    {product.product_name}
                    {product.color && ` (${product.color})`}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="destructive" className="text-xs">
                    當前庫存: {product.current_stock.toFixed(2)} kg
                  </Badge>
                  <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">
                    預警閾值: {product.threshold.toFixed(2)} kg
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
};
