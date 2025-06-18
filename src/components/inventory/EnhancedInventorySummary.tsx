import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, AlertTriangle, TrendingUp, Archive } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { StockBadge } from './StockBadge';
import { StockAlertBadge } from './StockAlertBadge';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

interface InventorySummaryData {
  product_id: string;
  product_name: string;
  color: string | null;
  color_code: string | null;
  total_stock: number;
  total_rolls: number;
  pending_in_quantity: number | null;
  pending_out_quantity: number | null;
  stock_thresholds: number | null;
  a_grade_stock: number;
  b_grade_stock: number;
  c_grade_stock: number;
  d_grade_stock: number;
  defective_stock: number;
  a_grade_rolls: number;
  b_grade_rolls: number;
  c_grade_rolls: number;
  d_grade_rolls: number;
  defective_rolls: number;
  a_grade_details: string[] | null;
  b_grade_details: string[] | null;
  c_grade_details: string[] | null;
  d_grade_details: string[] | null;
  defective_details: string[] | null;
  product_status: string | null;
}

export const EnhancedInventorySummary = () => {
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: inventorySummary, isLoading } = useQuery({
    queryKey: ['inventory-summary-enhanced', organizationId],
    queryFn: async (): Promise<InventorySummaryData[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('inventory_summary_enhanced')
        .select('*')
        .eq('organization_id', organizationId);
      
      if (error) throw error;
      return data || [];
    },
    enabled: hasOrganization
  });

  const columns: TableColumn[] = [
    {
      key: 'product_name',
      title: '產品名稱',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'color',
      title: '顏色',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'color_code',
      title: '色碼',
      sortable: false,
      filterable: false,
      render: (value) => value ? (
        <div className="flex items-center space-x-2">
          <div 
            className="w-4 h-4 rounded border border-gray-400"
            style={{ backgroundColor: value }}
          />
          <span className="text-sm text-gray-900">{value}</span>
        </div>
      ) : (
        <span className="text-gray-500">-</span>
      )
    },
    {
      key: 'total_stock',
      title: '總庫存',
      sortable: true,
      filterable: false,
      render: (value, row) => (
        <StockBadge 
          currentStock={value} 
          threshold={row.stock_thresholds}
          type="stock"
        />
      )
    },
    {
      key: 'total_rolls',
      title: '總卷數',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'pending_in_quantity',
      title: '待入庫',
      sortable: true,
      filterable: false,
      render: (value) => <StockBadge currentStock={value || 0} type="pending-in" />
    },
    {
      key: 'pending_out_quantity',
      title: '待出貨',
      sortable: true,
      filterable: false,
      render: (value) => <StockBadge currentStock={value || 0} type="pending-out" />
    },
    {
      key: 'stock_thresholds',
      title: '庫存狀態',
      sortable: false,
      filterable: false,
      render: (value, row) => (
        <StockAlertBadge 
          currentStock={row.total_stock} 
          threshold={value}
        />
      )
    }
  ];

  if (!hasOrganization) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-700">請先選擇組織</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-700">載入中...</div>
        </CardContent>
      </Card>
    );
  }

  const totalProducts = inventorySummary?.length || 0;
  const totalStock = inventorySummary?.reduce((sum, item) => sum + (item.total_stock || 0), 0) || 0;
  const totalRolls = inventorySummary?.reduce((sum, item) => sum + (item.total_rolls || 0), 0) || 0;
  const lowStockItems = inventorySummary?.filter(item => 
    item.stock_thresholds && item.total_stock < item.stock_thresholds
  ).length || 0;

  return (
    <div className="space-y-6">
      {/* 統計卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">產品種類</p>
                <p className="text-2xl font-bold text-gray-900">{totalProducts}</p>
              </div>
              <Package className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">總庫存</p>
                <p className="text-2xl font-bold text-gray-900">{totalStock.toFixed(1)} KG</p>
              </div>
              <Archive className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">總卷數</p>
                <p className="text-2xl font-bold text-gray-900">{totalRolls}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">庫存警告</p>
                <p className="text-2xl font-bold text-gray-900">{lowStockItems}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 庫存明細表格 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">庫存明細</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={inventorySummary || []}
            loading={isLoading}
            searchPlaceholder="搜尋產品名稱、顏色..."
            emptyMessage="目前沒有庫存資料"
          />
        </CardContent>
      </Card>
    </div>
  );
};
