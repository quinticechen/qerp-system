
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ProductWithThreshold {
  id: string;
  name: string;
  category: string;
  color: string | null;
  color_code: string | null;
  unit_of_measure: string;
  created_at: string;
  stock_thresholds: Array<{
    threshold_quantity: number;
  }> | null;
}

export const ProductList: React.FC = () => {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products-with-thresholds'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products_new')
        .select(`
          id,
          name,
          category,
          color,
          color_code,
          unit_of_measure,
          created_at,
          stock_thresholds (
            threshold_quantity
          )
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as ProductWithThreshold[];
    }
  });

  const getProductDisplayName = (product: ProductWithThreshold) => {
    return product.color ? `${product.name} (${product.color})` : product.name;
  };

  const getThresholdInfo = (product: ProductWithThreshold) => {
    if (product.stock_thresholds && product.stock_thresholds.length > 0) {
      return product.stock_thresholds[0].threshold_quantity;
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900 flex items-center gap-2">
          產品列表
          <Badge variant="outline" className="text-xs">
            {products.length} 個產品
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">載入中...</div>
        ) : products.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            尚未新增任何產品
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-gray-900">產品名稱</TableHead>
                <TableHead className="text-gray-900">類別</TableHead>
                <TableHead className="text-gray-900">顏色</TableHead>
                <TableHead className="text-gray-900">色號</TableHead>
                <TableHead className="text-gray-900">單位</TableHead>
                <TableHead className="text-gray-900">庫存閾值</TableHead>
                <TableHead className="text-gray-900">建立日期</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const threshold = getThresholdInfo(product);
                
                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium text-gray-900">
                      {getProductDisplayName(product)}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {product.category}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {product.color || '-'}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {product.color_code || '-'}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {product.unit_of_measure}
                    </TableCell>
                    <TableCell>
                      {threshold ? (
                        <Badge variant="outline" className="text-orange-600 border-orange-300">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {threshold.toFixed(2)} kg
                        </Badge>
                      ) : (
                        <span className="text-gray-400">未設定</span>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {new Date(product.created_at).toLocaleDateString('zh-TW')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
