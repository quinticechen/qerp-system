
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { EditOrderDialog } from './EditOrderDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';

interface OrderFactory {
  id: string;
  factories: {
    name: string;
  } | null;
}

interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  status: string;
  payment_status: string;
  shipping_status: string;
  note: string | null;
  created_at: string;
  customers: {
    name: string;
  } | null;
  order_products: Array<{
    id: string;
    quantity: number;
    unit_price: number;
    products_new: {
      name: string;
      color: string;
    } | null;
  }> | null;
  order_factories: OrderFactory[] | null;
}

export const OrderList = () => {
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const { data: orders, isLoading, error, refetch } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      console.log('Fetching orders...');
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (name),
          order_products (
            id,
            quantity,
            unit_price,
            shipped_quantity,
            products_new (name, color)
          ),
          order_factories (
            id,
            factories (name)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching orders:', error);
        throw error;
      }

      console.log('Fetched orders:', data);
      return data as Order[];
    }
  });

  const getStatusBadge = (status: string) => {
    const statusMap = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
      factory_ordered: 'bg-purple-100 text-purple-800 border-purple-200',
      completed: 'bg-green-100 text-green-800 border-green-200',
      cancelled: 'bg-red-100 text-red-800 border-red-200'
    };
    return statusMap[status as keyof typeof statusMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getPaymentStatusBadge = (status: string) => {
    const statusMap = {
      unpaid: 'bg-red-100 text-red-800 border-red-200',
      partial_paid: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      paid: 'bg-green-100 text-green-800 border-green-200'
    };
    return statusMap[status as keyof typeof statusMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getShippingStatusBadge = (status: string) => {
    const statusMap = {
      not_started: 'bg-gray-100 text-gray-800 border-gray-200',
      partial_shipped: 'bg-orange-100 text-orange-800 border-orange-200',
      shipped: 'bg-green-100 text-green-800 border-green-200'
    };
    return statusMap[status as keyof typeof statusMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getStatusText = (status: string) => {
    const textMap = {
      pending: '待處理',
      confirmed: '已確認',
      factory_ordered: '已向工廠下單',
      completed: '已完成',
      cancelled: '已取消',
      unpaid: '未付款',
      partial_paid: '部分付款',
      paid: '已付款',
      not_started: '未開始',
      partial_shipped: '部分出貨',
      shipped: '已出貨'
    };
    return textMap[status as keyof typeof textMap] || status;
  };

  const calculateOrderTotal = (order: Order) => {
    if (!order.order_products || !Array.isArray(order.order_products)) {
      return 0;
    }
    return order.order_products.reduce((total, product) => 
      total + (product.quantity * product.unit_price), 0
    );
  };

  const columns: TableColumn[] = [
    {
      key: 'order_number',
      title: '訂單編號',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'customers.name',
      title: '客戶',
      sortable: true,
      filterable: false,
      render: (value, row) => <span className="text-gray-700">{row.customers?.name || '未知客戶'}</span>
    },
    {
      key: 'order_factories',
      title: '關聯工廠',
      sortable: false,
      filterable: false,
      render: (value, row) => (
        row.order_factories && row.order_factories.length > 0 ? (
          <div className="space-y-1">
            {row.order_factories.map((orderFactory: OrderFactory, index: number) => (
              <div key={index} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                {orderFactory.factories?.name}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-gray-500 text-sm">無關聯工廠</span>
        )
      )
    },
    {
      key: 'status',
      title: '訂單狀態',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'pending', label: '待處理' },
        { value: 'confirmed', label: '已確認' },
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
      filterable: true,
      filterOptions: [
        { value: 'unpaid', label: '未付款' },
        { value: 'partial_paid', label: '部分付款' },
        { value: 'paid', label: '已付款' }
      ],
      render: (value) => (
        <Badge variant="outline" className={getPaymentStatusBadge(value)}>
          {getStatusText(value)}
        </Badge>
      )
    },
    {
      key: 'shipping_status',
      title: '出貨狀態',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'not_started', label: '未開始' },
        { value: 'partial_shipped', label: '部分出貨' },
        { value: 'shipped', label: '已出貨' }
      ],
      render: (value) => (
        <Badge variant="outline" className={getShippingStatusBadge(value)}>
          {getStatusText(value)}
        </Badge>
      )
    },
    {
      key: 'total_amount',
      title: '總金額',
      sortable: true,
      filterable: false,
      render: (value, row) => (
        <span className="text-gray-900 font-medium">
          ${calculateOrderTotal(row).toLocaleString()}
        </span>
      )
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditingOrder(row)}
          className="text-gray-800 hover:text-gray-900 hover:bg-gray-100 border-gray-300"
        >
          <Edit className="h-4 w-4" />
        </Button>
      )
    }
  ];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-700">載入中...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-red-600">載入訂單時發生錯誤</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader className="border-b border-gray-100">
        <CardTitle className="text-gray-900">訂單列表</CardTitle>
        <CardDescription className="text-gray-600">
          管理客戶訂單
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6">
        <EnhancedTable
          columns={columns}
          data={orders || []}
          loading={isLoading}
          searchPlaceholder="搜尋訂單編號、客戶名稱..."
          emptyMessage="暫無訂單"
        />

        {editingOrder && (
          <EditOrderDialog
            order={editingOrder}
            open={!!editingOrder}
            onOpenChange={(open) => !open && setEditingOrder(null)}
            onOrderUpdated={refetch}
          />
        )}
      </CardContent>
    </Card>
  );
};
