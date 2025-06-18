
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { EditOrderDialog } from './EditOrderDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

export const OrderList = () => {
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: orders, isLoading, refetch } = useQuery({
    queryKey: ['orders', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.log('No organization ID available');
        return [];
      }

      console.log('Fetching orders for organization:', organizationId);
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (name),
          order_products (
            id,
            quantity,
            unit_price,
            products_new (name, color)
          )
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching orders:', error);
        throw error;
      }

      console.log('Fetched orders:', data);
      return data;
    },
    enabled: hasOrganization
  });

  const handleEdit = (order: any) => {
    setSelectedOrder(order);
    setEditDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const statusMap = {
      'pending': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'confirmed': 'bg-blue-100 text-blue-800 border-blue-200',
      'in_production': 'bg-purple-100 text-purple-800 border-purple-200',
      'factory_ordered': 'bg-indigo-100 text-indigo-800 border-indigo-200',
      'completed': 'bg-green-100 text-green-800 border-green-200',
      'cancelled': 'bg-red-100 text-red-800 border-red-200'
    };
    return statusMap[status as keyof typeof statusMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getStatusText = (status: string) => {
    const textMap = {
      'pending': '待處理',
      'confirmed': '已確認',
      'in_production': '生產中',
      'factory_ordered': '已向工廠下單',
      'completed': '已完成',
      'cancelled': '已取消'
    };
    return textMap[status as keyof typeof textMap] || status;
  };

  const columns: TableColumn[] = [
    {
      key: 'order_number',
      title: '訂單號',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'customers.name',
      title: '客戶',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="text-gray-700">{row.customers?.name}</span>
    },
    {
      key: 'status',
      title: '狀態',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'pending', label: '待處理' },
        { value: 'confirmed', label: '已確認' },
        { value: 'in_production', label: '生產中' },
        { value: 'factory_ordered', label: '已向工廠下單' },
        { value: 'completed', label: '已完成' },
        { value: 'cancelled', label: '已取消' }
      ],
      render: (value) => (
        <Badge variant="outline" className={getStatusBadge(value)}>
          {getStatusText(value)}
        </Badge>
      )
    },
    {
      key: 'payment_status',
      title: '付款狀態',
      sortable: true,
      filterable: false,
      render: (value) => {
        const paymentStatusMap = {
          'unpaid': '未付款',
          'partial_paid': '部分付款',
          'paid': '已付款'
        };
        return <span className="text-gray-700">{paymentStatusMap[value as keyof typeof paymentStatusMap] || value}</span>;
      }
    },
    {
      key: 'shipping_status',
      title: '出貨狀態',
      sortable: true,
      filterable: false,
      render: (value) => {
        const shippingStatusMap = {
          'not_started': '未開始',
          'partial_shipped': '部分出貨',
          'shipped': '已出貨'
        };
        return <span className="text-gray-700">{shippingStatusMap[value as keyof typeof shippingStatusMap] || value}</span>;
      }
    },
    {
      key: 'created_at',
      title: '建立時間',
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
            onClick={() => handleEdit(row)}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Edit className="h-4 w-4" />
          </Button>
        </div>
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">訂單列表</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={orders || []}
            loading={isLoading}
            searchPlaceholder="搜尋訂單號、客戶名稱..."
            emptyMessage="沒有找到訂單"
          />
        </CardContent>
      </Card>

      {/* 編輯對話框 */}
      {selectedOrder && (
        <EditOrderDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          order={selectedOrder}
          onOrderUpdated={refetch}
        />
      )}
    </div>
  );
};
