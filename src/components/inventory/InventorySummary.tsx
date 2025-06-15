
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface InventorySummaryItem {
  product_id: string;
  product_name: string;
  color: string | null;
  total_stock: number;
  total_rolls: number;
  a_grade_stock: number;
  b_grade_stock: number;
  c_grade_stock: number;
  d_grade_stock: number;
  defective_stock: number;
}

export const InventorySummary: React.FC = () => {
  const { data: inventorySummary, isLoading } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_summary')
        .select('*')
        .order('product_name, color');
      
      if (error) throw error;
      return data as InventorySummaryItem[];
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">庫存統計</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-gray-500">載入中...</div>
        </CardContent>
      </Card>
    );
  }

  const getStockBadgeColor = (stock: number) => {
    if (stock === 0) return 'bg-gray-100 text-gray-800';
    if (stock < 100) return 'bg-red-100 text-red-800';
    if (stock < 500) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900">庫存統計</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-gray-900">產品名稱</TableHead>
                <TableHead className="text-gray-900">顏色</TableHead>
                <TableHead className="text-gray-900">總庫存</TableHead>
                <TableHead className="text-gray-900">總卷數</TableHead>
                <TableHead className="text-gray-900">A級</TableHead>
                <TableHead className="text-gray-900">B級</TableHead>
                <TableHead className="text-gray-900">C級</TableHead>
                <TableHead className="text-gray-900">D級</TableHead>
                <TableHead className="text-gray-900">瑕疵品</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventorySummary?.map((item) => (
                <TableRow key={`${item.product_id}-${item.color || 'no-color'}`}>
                  <TableCell className="font-medium text-gray-900">
                    {item.product_name}
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.color || '-'}
                  </TableCell>
                  <TableCell>
                    <Badge className={getStockBadgeColor(item.total_stock)}>
                      {item.total_stock.toFixed(2)} kg
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.total_rolls} 卷
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.a_grade_stock.toFixed(2)} kg
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.b_grade_stock.toFixed(2)} kg
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.c_grade_stock.toFixed(2)} kg
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.d_grade_stock.toFixed(2)} kg
                  </TableCell>
                  <TableCell className="text-gray-700">
                    {item.defective_stock.toFixed(2)} kg
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {(!inventorySummary || inventorySummary.length === 0) && (
          <div className="text-center py-8 text-gray-500">
            暫無庫存資料
          </div>
        )}
      </CardContent>
    </Card>
  );
};
