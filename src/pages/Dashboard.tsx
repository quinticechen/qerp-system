import React, { useState } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Package, 
  Users, 
  ShoppingCart, 
  Truck, 
  TrendingUp, 
  AlertTriangle,
  Plus,
  Eye,
  Edit
} from 'lucide-react';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CreateProductDialog } from '@/components/product/CreateProductDialog';
import { CreateCustomerDialog } from '@/components/customer/CreateCustomerDialog';
import { CreatePurchaseOrderDialog } from '@/components/purchase/CreatePurchaseOrderDialog';
import { CreateShippingDialog } from '@/components/shipping/CreateShippingDialog';
import { useNavigate } from 'react-router-dom';

const Dashboard = () => {
  const { organization, organizationId, hasOrganization } = useCurrentOrganization();
  const navigate = useNavigate();
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createPurchaseOpen, setCreatePurchaseOpen] = useState(false);
  const [createShippingOpen, setCreateShippingOpen] = useState(false);

  // 獲取組織統計資料
  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      // 獲取訂單統計
      const { data: orders } = await supabase
        .from('orders')
        .select('id, status, shipping_status')
        .eq('organization_id', organizationId);

      // 獲取產品統計
      const { data: products } = await supabase
        .from('products_new')
        .select('id')
        .eq('organization_id', organizationId);

      // 獲取客戶統計
      const { data: customers } = await supabase
        .from('customers')
        .select('id')
        .eq('organization_id', organizationId);

      // 獲取待出貨訂單（修正邏輯）
      const { data: pendingShipments } = await supabase
        .from('orders')
        .select('id')
        .eq('organization_id', organizationId)
        .in('shipping_status', ['not_started', 'partial_shipped']);

      return {
        totalOrders: orders?.length || 0,
        totalProducts: products?.length || 0,
        totalCustomers: customers?.length || 0,
        pendingShipments: pendingShipments?.length || 0
      };
    },
    enabled: hasOrganization
  });

  // 獲取最近訂單
  const { data: recentOrders } = useQuery({
    queryKey: ['recent-orders', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          status,
          created_at,
          customers (name)
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(4);

      return data || [];
    },
    enabled: hasOrganization
  });

  const statsData = [
    { title: '總訂單', value: stats?.totalOrders || 0, change: '+12%', icon: ShoppingCart, color: 'text-blue-600' },
    { title: '庫存產品', value: stats?.totalProducts || 0, change: '+5%', icon: Package, color: 'text-green-600' },
    { title: '活躍客戶', value: stats?.totalCustomers || 0, change: '+8%', icon: Users, color: 'text-purple-600' },
    { title: '待出貨', value: stats?.pendingShipments || 0, change: '-3%', icon: Truck, color: 'text-orange-600' }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'confirmed': return 'bg-blue-100 text-blue-800';
      case 'shipped': return 'bg-green-100 text-green-800';
      case 'completed': return 'bg-emerald-100 text-emerald-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '待處理';
      case 'confirmed': return '已確認';
      case 'shipped': return '已出貨';
      case 'completed': return '已完成';
      default: return status;
    }
  };

  const handleProductCreated = () => {
    setCreateProductOpen(false);
    navigate('/products');
  };

  const handleCustomerCreated = () => {
    setCreateCustomerOpen(false);
    navigate('/customers');
  };

  const handlePurchaseCreated = () => {
    setCreatePurchaseOpen(false);
    navigate('/purchases');
  };

  const handleShippingCreated = () => {
    setCreateShippingOpen(false);
    navigate('/shipping');
  };

  if (!hasOrganization) {
    return (
      <Layout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-slate-800">系統總覽</h2>
          </div>
          <Card>
            <CardContent className="p-6">
              <div className="text-center text-gray-700">請先選擇組織</div>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">系統總覽</h2>
            <p className="text-slate-600 mt-1">{organization?.name} 的營運儀表板</p>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statsData.map((stat, index) => (
            <Card key={index} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">{stat.title}</p>
                    <p className="text-2xl font-bold text-slate-800">{stat.value}</p>
                    <p className={`text-sm ${stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                      {stat.change} 較上月
                    </p>
                  </div>
                  <div className={`p-3 rounded-full bg-slate-50 ${stat.color}`}>
                    <stat.icon size={24} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 最近訂單 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">最近訂單</h3>
                <Button variant="outline" size="sm" onClick={() => navigate('/orders')}>
                  <Eye size={16} className="mr-2" />
                  查看全部
                </Button>
              </div>
              <p className="text-sm text-slate-600 mb-4">最新的客戶訂單記錄</p>
              <div className="space-y-4">
                {recentOrders?.map((order) => (
                  <div key={order.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div>
                      <p className="font-medium text-slate-800">{order.order_number}</p>
                      <p className="text-sm text-slate-600">{order.customers?.name}</p>
                    </div>
                    <div className="text-right">
                      <Badge className={getStatusColor(order.status)}>
                        {getStatusText(order.status)}
                      </Badge>
                      <p className="text-sm text-slate-600 mt-1">
                        {new Date(order.created_at).toLocaleDateString('zh-TW')}
                      </p>
                    </div>
                  </div>
                )) || (
                  <div className="text-center py-4 text-slate-500">暫無訂單資料</div>
                )}
              </div>
            </div>
          </Card>

          {/* 快速操作 */}
          <Card>
            <div className="p-6">
              <div className="flex items-center text-blue-600 mb-4">
                <TrendingUp size={20} className="mr-2" />
                <h3 className="text-lg font-semibold">快速操作</h3>
              </div>
              <p className="text-sm text-slate-600 mb-4">常用功能快速入口</p>
              <div className="space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => setCreateProductOpen(true)}
                >
                  <Package size={16} className="mr-2" />
                  新增產品
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => setCreateCustomerOpen(true)}
                >
                  <Users size={16} className="mr-2" />
                  新增客戶
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => setCreatePurchaseOpen(true)}
                >
                  <ShoppingCart size={16} className="mr-2" />
                  建立採購單
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => setCreateShippingOpen(true)}
                >
                  <Truck size={16} className="mr-2" />
                  安排出貨
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* 對話框 */}
        <CreateProductDialog
          open={createProductOpen}
          onOpenChange={setCreateProductOpen}
          onProductCreated={handleProductCreated}
        />
        <CreateCustomerDialog
          open={createCustomerOpen}
          onOpenChange={setCreateCustomerOpen}
          onCustomerCreated={handleCustomerCreated}
        />
        <CreatePurchaseOrderDialog
          open={createPurchaseOpen}
          onOpenChange={setCreatePurchaseOpen}
          onPurchaseCreated={handlePurchaseCreated}
        />
        <CreateShippingDialog
          open={createShippingOpen}
          onOpenChange={setCreateShippingOpen}
          onShippingCreated={handleShippingCreated}
        />
      </div>
    </Layout>
  );
};

export default Dashboard;
