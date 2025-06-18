
import React, { useState } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Package, Users, ShoppingCart, TrendingUp } from 'lucide-react';
import { CreatePurchaseDialog } from '@/components/purchase/CreatePurchaseDialog';
import { CreateShippingDialog } from '@/components/shipping/CreateShippingDialog';

const Dashboard = () => {
  const [isPurchaseDialogOpen, setIsPurchaseDialogOpen] = useState(false);
  const [isShippingDialogOpen, setIsShippingDialogOpen] = useState(false);

  // 獲取總體統計數據
  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [
        { count: totalProducts },
        { count: totalOrders },
        { count: totalCustomers },
        { data: inventoryData }
      ] = await Promise.all([
        supabase.from('products_new').select('*', { count: 'exact', head: true }),
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('customers').select('*', { count: 'exact', head: true }),
        supabase.from('inventory_summary').select('total_stock').limit(1000)
      ]);

      const totalInventory = inventoryData?.reduce((sum, item) => sum + (item.total_stock || 0), 0) || 0;

      return {
        totalProducts: totalProducts || 0,
        totalOrders: totalOrders || 0,
        totalCustomers: totalCustomers || 0,
        totalInventory
      };
    }
  });

  // 獲取最近訂單
  const { data: recentOrders } = useQuery({
    queryKey: ['recent-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (name),
          order_products (
            quantity,
            unit_price,
            products_new (name)
          )
        `)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data;
    }
  });

  // 獲取庫存警報
  const { data: lowStockItems } = useQuery({
    queryKey: ['low-stock-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_summary_enhanced')
        .select('*')
        .not('stock_thresholds', 'is', null)
        .order('product_name')
        .limit(10);

      if (error) throw error;
      
      return data?.filter(item => 
        item.stock_thresholds && 
        item.total_stock !== null && 
        Number(item.total_stock) < Number(item.stock_thresholds)
      ) || [];
    }
  });

  const getOrderStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      'pending': '待處理',
      'confirmed': '已確認',
      'in_production': '製作中',
      'completed': '已完成',
      'cancelled': '已取消',
      'factory_ordered': '已向工廠下單'
    };
    return statusMap[status] || status;
  };

  const getOrderStatusBadge = (status: string) => {
    const statusMap: Record<string, string> = {
      'pending': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'confirmed': 'bg-blue-100 text-blue-800 border-blue-200',
      'in_production': 'bg-purple-100 text-purple-800 border-purple-200',
      'completed': 'bg-green-100 text-green-800 border-green-200',
      'cancelled': 'bg-red-100 text-red-800 border-red-200',
      'factory_ordered': 'bg-indigo-100 text-indigo-800 border-indigo-200'
    };
    return statusMap[status] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">系統總覽</h1>
          <div className="flex gap-2">
            <Button 
              onClick={() => setIsPurchaseDialogOpen(true)}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              新增採購
            </Button>
            <Button 
              onClick={() => setIsShippingDialogOpen(true)}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              新增出貨
            </Button>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Package className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">總產品數</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.totalProducts || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <ShoppingCart className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">總訂單數</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.totalOrders || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-purple-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">總客戶數</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.totalCustomers || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <TrendingUp className="h-8 w-8 text-orange-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">總庫存 (KG)</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.totalInventory?.toFixed(2) || '0.00'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 最近訂單 */}
          <Card>
            <CardHeader>
              <CardTitle>最近訂單</CardTitle>
              <CardDescription>最新的10筆訂單記錄</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentOrders?.map((order) => (
                  <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{order.order_number}</span>
                        <Badge variant="outline" className={getOrderStatusBadge(order.status)}>
                          {getOrderStatusText(order.status)}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600">{order.customers?.name}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(order.created_at).toLocaleDateString('zh-TW')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        ${order.order_products?.reduce((total: number, item: any) => 
                          total + (item.quantity * item.unit_price), 0
                        )?.toFixed(2) || '0.00'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {order.order_products?.length || 0} 項產品
                      </p>
                    </div>
                  </div>
                ))}
                {(!recentOrders || recentOrders.length === 0) && (
                  <p className="text-center text-gray-500 py-4">暫無訂單記錄</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 庫存警報 */}
          <Card>
            <CardHeader>
              <CardTitle>庫存警報</CardTitle>
              <CardDescription>低於安全庫存的產品</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {lowStockItems?.map((item) => (
                  <div key={item.product_id} className="flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium">{item.product_name}</p>
                      {item.color && (
                        <p className="text-sm text-gray-600">{item.color}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-orange-600">
                        {Number(item.total_stock).toFixed(2)} KG
                      </p>
                      <p className="text-xs text-gray-500">
                        警戒值: {Number(item.stock_thresholds).toFixed(2)} KG
                      </p>
                    </div>
                  </div>
                ))}
                {(!lowStockItems || lowStockItems.length === 0) && (
                  <p className="text-center text-gray-500 py-4">目前沒有庫存警報</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <CreatePurchaseDialog
          open={isPurchaseDialogOpen}
          onOpenChange={setIsPurchaseDialogOpen}
        />

        <CreateShippingDialog
          open={isShippingDialogOpen}
          onOpenChange={setIsShippingDialogOpen}
        />
      </div>
    </Layout>
  );
};

export default Dashboard;
