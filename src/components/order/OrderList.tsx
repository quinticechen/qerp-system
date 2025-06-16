
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Edit } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { EditOrderDialog } from './EditOrderDialog';

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
}

export const OrderList = () => {
  const [searchTerm, setSearchTerm] = useState('');
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

  const filteredOrders = orders?.filter(order => {
    const customerName = order.customers?.name || '未知客戶';
    return order.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customerName.toLowerCase().includes(searchTerm.toLowerCase());
  }) || [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'confirmed': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'partial_shipped': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      case 'cancelled': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'unpaid': return 'bg-red-100 text-red-800 border-red-200';
      case 'partial_paid': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'paid': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getShippingStatusColor = (status: string) => {
    switch (status) {
      case 'not_started': return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'partial_shipped': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'shipped': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '待處理';
      case 'confirmed': return '已確認';
      case 'factory_ordered': return '已向工廠下單';
      case 'completed': return '已完成';
      case 'cancelled': return '已取消';
      default: return status;
    }
  };

  const getPaymentStatusText = (status: string) => {
    switch (status) {
      case 'unpaid': return '未付款';
      case 'partial_paid': return '部分付款';
      case 'paid': return '已付款';
      default: return status;
    }
  };

  const getShippingStatusText = (status: string) => {
    switch (status) {
      case 'not_started': return '未開始';
      case 'partial_shipped': return '部分出貨';
      case 'shipped': return '已出貨';
      default: return status;
    }
  };

  const calculateOrderTotal = (order: Order) => {
    // 添加安全檢查，防止 order_products 為 null 或 undefined
    if (!order.order_products || !Array.isArray(order.order_products)) {
      return 0;
    }
    
    return order.order_products.reduce((total, product) => 
      total + (product.quantity * product.unit_price), 0
    );
  };

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
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
            <Input
              placeholder="搜尋訂單編號或客戶名稱..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 border-gray-300 text-gray-900 placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-gray-900 font-semibold">訂單編號</TableHead>
              <TableHead className="text-gray-900 font-semibold">客戶</TableHead>
              <TableHead className="text-gray-900 font-semibold">關聯工廠</TableHead>
              <TableHead className="text-gray-900 font-semibold">訂單狀態</TableHead>
              <TableHead className="text-gray-900 font-semibold">付款狀態</TableHead>
              <TableHead className="text-gray-900 font-semibold">出貨狀態</TableHead>
              <TableHead className="text-gray-900 font-semibold">總金額</TableHead>
              <TableHead className="text-gray-900 font-semibold">建立時間</TableHead>
              <TableHead className="text-gray-900 font-semibold">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOrders.map((order) => (
              <TableRow key={order.id} className="hover:bg-gray-50">
                <TableCell className="font-medium text-gray-900">
                  {order.order_number}
                </TableCell>
                <TableCell className="text-gray-800">
                  {order.customers?.name || '未知客戶'}
                </TableCell>
                <TableCell className="text-gray-800">
                  {order.order_factories && order.order_factories.length > 0 ? (
                    <div className="space-y-1">
                      {order.order_factories.map((of: any, index: number) => (
                        <div key={index} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {of.factories?.name}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-500 text-sm">無關聯工廠</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={getStatusColor(order.status)}>
                    {getStatusText(order.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={getPaymentStatusColor(order.payment_status)}>
                    {getPaymentStatusText(order.payment_status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={getShippingStatusColor(order.shipping_status)}>
                    {getShippingStatusText(order.shipping_status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-gray-900 font-medium">
                  ${calculateOrderTotal(order).toLocaleString()}
                </TableCell>
                <TableCell className="text-gray-800">
                  {new Date(order.created_at).toLocaleDateString('zh-TW')}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingOrder(order)}
                    className="text-gray-800 hover:text-gray-900 hover:bg-gray-100 border-gray-300"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredOrders.length === 0 && (
          <div className="text-center py-8 text-gray-600">
            {searchTerm ? '沒有找到符合條件的訂單' : '尚無訂單'}
          </div>
        )}

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
