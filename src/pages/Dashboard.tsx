import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Package, 
  Users, 
  Factory, 
  Warehouse, 
  ShoppingCart, 
  Truck, 
  TrendingUp, 
  AlertTriangle,
  BarChart3,
  Settings,
  LogOut,
  Bell,
  Search,
  Plus,
  Eye,
  Edit,
  Archive
} from 'lucide-react';
import ProductManagement from '@/components/ProductManagement';
import CustomerManagement from '@/components/CustomerManagement';
import OrderManagement from '@/components/OrderManagement';
import InventoryManagement from '@/components/InventoryManagement';
import FactoryManagement from '@/components/FactoryManagement';
import SystemSettings from '@/components/SystemSettings';

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('overview');

  // 模擬數據
  const stats = [
    { title: '總訂單', value: '156', change: '+12%', icon: ShoppingCart, color: 'text-blue-600' },
    { title: '庫存產品', value: '2,341', change: '+5%', icon: Package, color: 'text-green-600' },
    { title: '活躍客戶', value: '89', change: '+8%', icon: Users, color: 'text-purple-600' },
    { title: '待出貨', value: '23', change: '-3%', icon: Truck, color: 'text-orange-600' }
  ];

  const recentOrders = [
    { id: 'ORD-20250115-0001', customer: '永豐紡織', status: 'pending', amount: '¥52,000' },
    { id: 'ORD-20250115-0002', customer: '昌隆實業', status: 'confirmed', amount: '¥78,500' },
    { id: 'ORD-20250115-0003', customer: '宏達布料', status: 'shipped', amount: '¥34,200' },
    { id: 'ORD-20250115-0004', customer: '美生織品', status: 'completed', amount: '¥91,300' }
  ];

  const lowStockItems = [
    { name: '純棉帆布 - 米白', current: 45, threshold: 100, unit: 'KG' },
    { name: '聚酯纖維 - 深藍', current: 23, threshold: 50, unit: 'KG' },
    { name: '混紡布料 - 灰色', current: 12, threshold: 30, unit: 'KG' }
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

  const renderContent = () => {
    switch (activeTab) {
      case 'products':
        return <ProductManagement />;
      case 'customers':
        return <CustomerManagement />;
      case 'orders':
        return <OrderManagement />;
      case 'inventory':
        return <InventoryManagement />;
      case 'factories':
        return <FactoryManagement />;
      case 'settings':
        return <SystemSettings />;
      case 'overview':
      default:
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-800">系統總覽</h2>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus size={16} className="mr-2" />
                新增訂單
              </Button>
            </div>

            {/* 統計卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.map((stat, index) => (
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

            {/* 最近訂單和庫存警告 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 最近訂單 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    最近訂單
                    <Button variant="outline" size="sm">
                      <Eye size={16} className="mr-2" />
                      查看全部
                    </Button>
                  </CardTitle>
                  <CardDescription>最新的客戶訂單記錄</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {recentOrders.map((order) => (
                      <div key={order.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div>
                          <p className="font-medium text-slate-800">{order.id}</p>
                          <p className="text-sm text-slate-600">{order.customer}</p>
                        </div>
                        <div className="text-right">
                          <Badge className={getStatusColor(order.status)}>
                            {getStatusText(order.status)}
                          </Badge>
                          <p className="text-sm font-medium text-slate-800 mt-1">{order.amount}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* 庫存警告 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center text-orange-600">
                    <AlertTriangle size={20} className="mr-2" />
                    庫存警告
                  </CardTitle>
                  <CardDescription>以下產品庫存偏低，建議補貨</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {lowStockItems.map((item, index) => (
                      <div key={index} className="p-3 border border-orange-200 bg-orange-50 rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <p className="font-medium text-slate-800">{item.name}</p>
                          <Button variant="outline" size="sm">
                            <Edit size={14} className="mr-1" />
                            採購
                          </Button>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">
                            當前: {item.current} {item.unit}
                          </span>
                          <span className="text-slate-600">
                            閾值: {item.threshold} {item.unit}
                          </span>
                        </div>
                        <div className="mt-2 bg-white rounded-full h-2">
                          <div 
                            className="bg-orange-500 h-2 rounded-full"
                            style={{ width: `${(item.current / item.threshold) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 頂部導航欄 */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <div className="w-4 h-4 bg-white rounded"></div>
              </div>
              <h1 className="text-xl font-bold text-slate-800">紡織業 ERP</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="搜尋..."
                  className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <Button variant="ghost" size="icon">
                <Bell size={20} />
              </Button>
              <Button variant="ghost" size="icon">
                <Settings size={20} />
              </Button>
              <Button variant="ghost" size="icon">
                <LogOut size={20} />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* 側邊導航 */}
      <div className="flex">
        <nav className="w-64 bg-white border-r border-slate-200 min-h-[calc(100vh-64px)]">
          <div className="p-4 space-y-2">
            {[
              { id: 'overview', label: '總覽', icon: BarChart3 },
              { id: 'products', label: '產品管理', icon: Package },
              { id: 'customers', label: '客戶管理', icon: Users },
              { id: 'orders', label: '訂單管理', icon: ShoppingCart },
              { id: 'inventory', label: '庫存管理', icon: Warehouse },
              { id: 'shipping', label: '出貨管理', icon: Truck },
              { id: 'factories', label: '供應商管理', icon: Factory }
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  activeTab === item.id
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                <item.icon size={20} />
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* 主內容區域 */}
        <main className="flex-1 p-6">
          {renderContent()}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
