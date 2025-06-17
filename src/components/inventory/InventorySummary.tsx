
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Package, TrendingDown, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { StockAlertBadge } from './StockAlertBadge';
import { useStockThresholds } from '@/hooks/useStockThresholds';
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';

type InventorySummaryItem = {
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
};

export const InventorySummary = () => {
  const [inventoryData, setInventoryData] = useState<InventorySummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { getThresholdByProductId } = useStockThresholds();
  const { alerts } = useInventoryAlerts();

  const loadInventorySummary = async () => {
    try {
      const { data, error } = await supabase
        .from('inventory_summary')
        .select('*')
        .order('product_name');

      if (error) throw error;

      const summaryData = (data || []).map(item => ({
        product_id: item.product_id || '',
        product_name: item.product_name || '未知產品',
        color: item.color,
        total_stock: Number(item.total_stock || 0),
        total_rolls: Number(item.total_rolls || 0),
        a_grade_stock: Number(item.a_grade_stock || 0),
        b_grade_stock: Number(item.b_grade_stock || 0),
        c_grade_stock: Number(item.c_grade_stock || 0),
        d_grade_stock: Number(item.d_grade_stock || 0),
        defective_stock: Number(item.defective_stock || 0),
      }));

      setInventoryData(summaryData);
    } catch (error) {
      console.error('Failed to load inventory summary:', error);
      setInventoryData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInventorySummary();
  }, []);

  const getTotalStock = () => {
    return inventoryData.reduce((sum, item) => sum + item.total_stock, 0);
  };

  const getTotalRolls = () => {
    return inventoryData.reduce((sum, item) => sum + item.total_rolls, 0);
  };

  const getLowStockCount = () => {
    return alerts.length;
  };

  const getCriticalStockCount = () => {
    return alerts.filter(alert => alert.alert_level === 'critical').length;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>庫存統計</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 統計卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Package className="h-8 w-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">總庫存重量</p>
                <p className="text-2xl font-bold text-gray-900">{getTotalStock().toFixed(2)} KG</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <TrendingUp className="h-8 w-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">總布卷數</p>
                <p className="text-2xl font-bold text-gray-900">{getTotalRolls()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <AlertTriangle className="h-8 w-8 text-orange-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">庫存不足</p>
                <p className="text-2xl font-bold text-orange-600">{getLowStockCount()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <TrendingDown className="h-8 w-8 text-red-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">嚴重不足</p>
                <p className="text-2xl font-bold text-red-600">{getCriticalStockCount()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 庫存預警提示 */}
      {alerts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center text-orange-800">
              <AlertTriangle className="mr-2" size={20} />
              庫存預警
            </CardTitle>
            <CardDescription className="text-orange-700">
              以下產品庫存已低於設定閾值，請及時補貨
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts.map((alert) => (
                <div key={alert.product_id} className="flex items-center justify-between p-3 bg-white rounded border">
                  <div>
                    <span className="font-medium text-gray-900">{alert.product_name}</span>
                    {alert.color && <span className="text-gray-600 ml-2">({alert.color})</span>}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant={alert.alert_level === 'critical' ? 'destructive' : 'secondary'}>
                      {alert.alert_level === 'critical' ? '嚴重不足' : '庫存不足'}
                    </Badge>
                    <span className="text-sm text-gray-600">
                      目前: {alert.current_stock} KG / 閾值: {alert.threshold_quantity} KG
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 詳細庫存表格 */}
      <Card>
        <CardHeader>
          <CardTitle>產品庫存明細</CardTitle>
          <CardDescription>
            按產品分類的詳細庫存信息，包含各等級庫存分布
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inventoryData.length === 0 ? (
            <div className="text-center py-8">
              <Package size={48} className="mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">暫無庫存數據</h3>
              <p className="text-gray-600">請先進行入庫操作</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>產品名稱</TableHead>
                  <TableHead>顏色</TableHead>
                  <TableHead className="text-right">總庫存</TableHead>
                  <TableHead className="text-right">布卷數</TableHead>
                  <TableHead className="text-right">A級</TableHead>
                  <TableHead className="text-right">B級</TableHead>
                  <TableHead className="text-right">C級</TableHead>
                  <TableHead className="text-right">D級</TableHead>
                  <TableHead className="text-right">瑕疵品</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventoryData.map((item) => {
                  const threshold = getThresholdByProductId(item.product_id);
                  return (
                    <TableRow key={`${item.product_id}-${item.color || 'default'}`}>
                      <TableCell className="font-medium">{item.product_name}</TableCell>
                      <TableCell>{item.color || '無'}</TableCell>
                      <TableCell>
                        <StockAlertBadge
                          currentStock={item.total_stock}
                          threshold={threshold?.threshold_quantity || null}
                        />
                      </TableCell>
                      <TableCell className="text-right">{item.total_rolls}</TableCell>
                      <TableCell className="text-right">{item.a_grade_stock.toFixed(2)} KG</TableCell>
                      <TableCell className="text-right">{item.b_grade_stock.toFixed(2)} KG</TableCell>
                      <TableCell className="text-right">{item.c_grade_stock.toFixed(2)} KG</TableCell>
                      <TableCell className="text-right">{item.d_grade_stock.toFixed(2)} KG</TableCell>
                      <TableCell className="text-right">{item.defective_stock.toFixed(2)} KG</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
