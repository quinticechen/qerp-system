
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { StockBadge } from './StockBadge';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

interface PendingShippingItem {
  product_name: string;
  color: string | null;
  color_code: string | null;
  total_pending: number;
  order_number: string;
  customer_name: string;
}

export const PendingShippingSection: React.FC = () => {
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: pendingShipping, isLoading } = useQuery({
    queryKey: ['pending-shipping', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('order_products')
        .select(`
          quantity,
          shipped_quantity,
          products_new (name, color, color_code),
          orders!inner (
            order_number,
            organization_id,
            customers (name)
          )
        `)
        .eq('orders.organization_id', organizationId)
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
      key: 'total_pending',
      title: '待出貨數量',
      sortable: true,
      filterable: false,
      render: (value) => <StockBadge currentStock={value} type="pending-out" />
    },
    {
      key: 'order_number',
      title: '訂單號',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'customer_name',
      title: '客戶',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    }
  ];

  if (!hasOrganization) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">待出貨</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-gray-500">請先選擇組織</div>
        </CardContent>
      </Card>
    );
  }

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
        <EnhancedTable
          columns={columns}
          data={pendingShipping || []}
          loading={isLoading}
          searchPlaceholder="搜尋產品名稱、訂單號、客戶..."
          emptyMessage="目前沒有待出貨的產品"
        />
      </CardContent>
    </Card>
  );
};
