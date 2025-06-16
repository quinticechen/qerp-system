
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface PendingInventoryItem {
  product_name: string;
  color: string | null;
  color_code: string | null;
  total_pending: number;
  po_number: string;
  factory_name: string;
  expected_arrival_date: string | null;
}

export const PendingInventorySection: React.FC = () => {
  const { data: pendingInventory, isLoading } = useQuery({
    queryKey: ['pending-inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select(`
          ordered_quantity,
          received_quantity,
          products_new (name, color, color_code),
          purchase_orders (
            po_number,
            expected_arrival_date,
            factories (name)
          )
        `)
        .in('status', ['pending', 'partial_received']);
      
      if (error) throw error;

      // 處理資料，計算待入庫數量
      const processedData = data.map(item => ({
        product_name: item.products_new?.name || '',
        color: item.products_new?.color || null,
        color_code: item.products_new?.color_code || null,
        total_pending: item.ordered_quantity - (item.received_quantity || 0),
        po_number: item.purchase_orders?.po_number || '',
        factory_name: item.purchase_orders?.factories?.name || '',
        expected_arrival_date: item.purchase_orders?.expected_arrival_date || null
      })).filter(item => item.total_pending > 0);

      return processedData as PendingInventoryItem[];
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">待入庫</CardTitle>
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
        <CardTitle className="text-gray-900">待入庫</CardTitle>
        <p className="text-sm text-gray-600">已經跟工廠下採購單但尚未入庫的產品</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-gray-900">產品名稱</TableHead>
                <TableHead className="text-gray-900">顏色</TableHead>
                <TableHead className="text-gray-900">色碼</TableHead>
                <TableHead className="text-gray-900">待入庫數量</TableHead>
                <TableHead className="text-gray-900">採購單號</TableHead>
                <TableHead className="text-gray-900">工廠</TableHead>
                <TableHead className="text-gray-900">預計到貨日期</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingInventory?.map((item, index) => (
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
                    <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-200">
                      {item.total_pending.toFixed(2)} kg
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.po_number}
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.factory_name}
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.expected_arrival_date 
                      ? new Date(item.expected_arrival_date).toLocaleDateString('zh-TW')
                      : '未設定'
                    }
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {(!pendingInventory || pendingInventory.length === 0) && (
          <div className="text-center py-8 text-gray-500">
            目前沒有待入庫的產品
          </div>
        )}
      </CardContent>
    </Card>
  );
};
