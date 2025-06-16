
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderProduct, InventoryInfo } from './types';

interface OrderProductsDisplayProps {
  orderProducts?: OrderProduct[];
  getInventoryInfo: (productId: string) => InventoryInfo | undefined;
}

export const OrderProductsDisplay: React.FC<OrderProductsDisplayProps> = ({
  orderProducts,
  getInventoryInfo,
}) => {
  if (!orderProducts || orderProducts.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900">關聯訂單產品資訊</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {orderProducts.map((orderProduct) => {
            const inventory = getInventoryInfo(orderProduct.products_new.id);
            
            return (
              <div key={orderProduct.id} className="border border-gray-200 rounded p-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="font-medium text-gray-900">
                      {orderProduct.products_new.name}
                    </div>
                    <div className="text-sm text-gray-600">
                      {orderProduct.products_new.color && (
                        <span className="flex items-center space-x-2">
                          {orderProduct.products_new.color_code && (
                            <div 
                              className="w-4 h-4 rounded border border-gray-400"
                              style={{ backgroundColor: orderProduct.products_new.color_code }}
                            ></div>
                          )}
                          <span>{orderProduct.products_new.color} {orderProduct.products_new.color_code}</span>
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      訂單: {orderProduct.orders.order_number}
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-sm text-gray-600">訂單數量</div>
                    <div className="font-medium text-gray-900">{orderProduct.quantity} kg</div>
                  </div>
                  
                  <div>
                    <div className="text-sm text-gray-600">庫存資訊</div>
                    {inventory ? (
                      <div className="text-sm">
                        <div>總庫存: {inventory.total_stock.toFixed(2)} kg</div>
                        <div className="text-xs text-gray-500">
                          A:{inventory.a_grade_stock.toFixed(2)} B:{inventory.b_grade_stock.toFixed(2)} 
                          C:{inventory.c_grade_stock.toFixed(2)} D:{inventory.d_grade_stock.toFixed(2)}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-red-600">無庫存</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
