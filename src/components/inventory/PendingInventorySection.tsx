
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { StockBadge } from './StockBadge';

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
      title: '待入庫數量',
      sortable: true,
      filterable: false,
      render: (value) => <StockBadge currentStock={value} type="pending-in" />
    },
    {
      key: 'po_number',
      title: '採購單號',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'factory_name',
      title: '工廠',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'expected_arrival_date',
      title: '預計到貨日期',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {value ? new Date(value).toLocaleDateString('zh-TW') : '未設定'}
        </span>
      )
    }
  ];

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
        <EnhancedTable
          columns={columns}
          data={pendingInventory || []}
          loading={isLoading}
          searchPlaceholder="搜尋產品名稱、採購單號、工廠..."
          emptyMessage="目前沒有待入庫的產品"
        />
      </CardContent>
    </Card>
  );
};
