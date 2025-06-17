
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eye, Edit } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ViewShippingDialog } from './ViewShippingDialog';
import { EditShippingDialog } from './EditShippingDialog';
import { useDebounce } from '@/hooks/useDebounce';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';

export const ShippingList = () => {
  const [selectedShipping, setSelectedShipping] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const { data: shippings, isLoading } = useQuery({
    queryKey: ['shippings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shippings')
        .select(`
          *,
          customers (name),
          orders (order_number),
          shipping_items (
            id,
            shipped_quantity,
            inventory_rolls (
              roll_number,
              products_new (name, color)
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  const handleView = (shipping: any) => {
    setSelectedShipping(shipping);
    setViewDialogOpen(true);
  };

  const handleEdit = (shipping: any) => {
    setSelectedShipping(shipping);
    setEditDialogOpen(true);
  };

  const columns: TableColumn[] = [
    {
      key: 'shipping_number',
      title: '出貨單號',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'customers.name',
      title: '客戶',
      sortable: true,
      filterable: true,
      filterOptions: customers?.map(customer => ({
        value: customer.id,
        label: customer.name
      })) || [],
      render: (value, row) => <span className="text-gray-700">{row.customers?.name}</span>
    },
    {
      key: 'orders.order_number',
      title: '關聯訂單',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="text-gray-700">{row.orders?.order_number || '-'}</span>
    },
    {
      key: 'total_shipped_quantity',
      title: '總重量',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value} 公斤</span>
    },
    {
      key: 'total_shipped_rolls',
      title: '總卷數',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value}</span>
    },
    {
      key: 'items_count',
      title: '項目數',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="text-gray-700">{row.shipping_items?.length || 0}</span>
    },
    {
      key: 'shipping_date',
      title: '出貨日期',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {new Date(value).toLocaleDateString('zh-TW')}
        </span>
      )
    },
    {
      key: 'actions',
      title: '操作',
      sortable: false,
      filterable: false,
      render: (value, row) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleView(row)}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleEdit(row)}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Edit className="h-4 w-4" />
          </Button>
        </div>
      )
    }
  ];

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">載入中...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">出貨單列表</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={shippings || []}
            loading={isLoading}
            searchPlaceholder="搜尋出貨單號、客戶名稱、訂單號..."
            emptyMessage="沒有找到出貨單"
          />
        </CardContent>
      </Card>

      {/* 對話框 */}
      {selectedShipping && (
        <>
          <ViewShippingDialog
            open={viewDialogOpen}
            onOpenChange={setViewDialogOpen}
            shipping={selectedShipping}
          />
          <EditShippingDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            shipping={selectedShipping}
          />
        </>
      )}
    </div>
  );
};
