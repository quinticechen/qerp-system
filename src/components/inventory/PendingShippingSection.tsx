
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface PendingShippingItem {
  product_name: string;
  color: string | null;
  color_code: string | null;
  total_pending: number;
  order_number: string;
  customer_name: string;
}

export const PendingShippingSection: React.FC = () => {
  const { data: pendingShipping, isLoading } = useQuery({
    queryKey: ['pending-shipping'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_products')
        .select(`
          quantity,
          shipped_quantity,
          products_new (name, color, color_code),
          orders (
            order_number,
            customers (name)
          )
        `)
        .in('status', ['pending', 'partial_shipped']);
      
      if (error) throw error;

      // 處理資料，計算待出貨數量
      const processedData = data.map(item => ({
        product_name: item.products_new?.name || '',
        color: item.products_new?.color || null,
        color_code: item.products_new?.color_code || null,
        total_pending: item.quantity - (item.shipped_quantity || 0),
        order_number: item.orders?.order_number || '',
        customer_name: item.orders?.customers?.name || ''
      })).filter(item => item.total_pending > 0);

      return processedData as PendingShippingItem[];
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">待出貨</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-gray-500">載入中...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900">待出貨</CardTitle>
        <p className="text-sm text-gray-600">還沒出貨給客人的產品</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-gray-900">產品名稱</TableHead>
                <TableHead className="text-gray-900">顏色</TableHead>
                <TableHead className="text-gray-900">色碼</TableHead>
                <TableHead className="text-gray-900">待出貨數量</TableHead>
                <TableHead className="text-gray-900">訂單號</TableHead>
                <TableHead className="text-gray-900">客戶</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingShipping?.map((item, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium text-gray-900">
                    {item.product_name}
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.color || '-'}
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.color_code ? (
                      <div className="flex items-center space-x-2">
                        <div 
                          className="w-4 h-4 rounded border border-gray-400"
                          style={{ backgroundColor: item.color_code }}
                        ></div>
                        <span className="text-sm text-gray-900">{item.color_code}</span>
                      </div>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
                      {item.total_pending.toFixed(2)} kg
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.order_number}
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.customer_name}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {(!pendingShipping || pendingShipping.length === 0) && (
          <div className="text-center py-8 text-gray-500">
            目前沒有待出貨的產品
          </div>
        )}
      </CardContent>
    </Card>
  );
};
