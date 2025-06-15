
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { 
  Package, 
  Users, 
  Factory, 
  Warehouse, 
  ShoppingCart, 
  BarChart3,
  Settings,
  LogOut,
  Bell,
  Search,
  User
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      toast({
        title: "登出成功",
        description: "已安全登出系統",
      });
      navigate('/login');
    } catch (error) {
      toast({
        title: "登出失敗",
        description: "請稍後再試",
        variant: "destructive",
      });
    }
  };

  const menuItems = [
    { id: 'dashboard', label: '儀表板', icon: BarChart3, path: '/dashboard' },
    { id: 'product', label: '產品管理', icon: Package, path: '/product' },
    { id: 'order', label: '訂單管理', icon: ShoppingCart, path: '/order' },
    { id: 'inventory', label: '庫存管理', icon: Warehouse, path: '/inventory' },
    { id: 'factory', label: '工廠管理', icon: Factory, path: '/factory' },
    { id: 'customer', label: '客戶管理', icon: Users, path: '/customer' },
    { id: 'user', label: '用戶管理', icon: User, path: '/user' },
    { id: 'system', label: '系統設定', icon: Settings, path: '/system' }
  ];

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
              <Button variant="ghost" size="icon" onClick={handleLogout}>
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
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  location.pathname === item.path
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
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
