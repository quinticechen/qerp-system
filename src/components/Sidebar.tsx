
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
  User,
  ClipboardList,
  Truck
} from 'lucide-react';

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { id: 'dashboard', label: '儀表板', icon: BarChart3, path: '/dashboard' },
    { id: 'product', label: '產品管理', icon: Package, path: '/product' },
    { id: 'order', label: '訂單管理', icon: ShoppingCart, path: '/order' },
    { id: 'purchase', label: '採購管理', icon: ClipboardList, path: '/purchase' },
    { id: 'inventory', label: '庫存管理', icon: Warehouse, path: '/inventory' },
    { id: 'shipping', label: '出貨管理', icon: Truck, path: '/shipping' },
    { id: 'factory', label: '工廠管理', icon: Factory, path: '/factory' },
    { id: 'customer', label: '客戶管理', icon: Users, path: '/customer' },
    { id: 'user', label: '用戶管理', icon: User, path: '/user' },
    { id: 'system', label: '系統設定', icon: Settings, path: '/system' }
  ];

  return (
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
  );
};

export default Sidebar;
