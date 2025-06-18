
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { StockBadge } from './StockBadge';
import { StockAlertBadge } from './StockAlertBadge';

interface InventoryItem {
  product_id: string;
  product_name: string;
  color: string | null;
  color_code: string | null;
  total_stock: number;
  total_rolls: number;
  pending_in_quantity: number | null;
  pending_out_quantity: number | null;
  stock_thresholds: number | null;
}

interface InventoryTableProps {
  data: InventoryItem[];
  loading: boolean;
}

export const InventoryTable = ({ data, loading }: InventoryTableProps) => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900">庫存明細</CardTitle>
      </CardHeader>
      <CardContent>
        <EnhancedTable
          columns={columns}
          data={data}
          loading={loading}
          searchPlaceholder="搜尋產品名稱、顏色..."
          emptyMessage="目前沒有庫存資料"
        />
      </CardContent>
    </Card>
  );
};
