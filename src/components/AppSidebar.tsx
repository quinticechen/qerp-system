
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader
} from '@/components/ui/sidebar';
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
  Truck,
  Shield
} from 'lucide-react';

export function AppSidebar() {
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
    { id: 'permission', label: '權限管理', icon: Shield, path: '/permission' },
    { id: 'system', label: '系統設定', icon: Settings, path: '/system' }
  ];

  return (
    <Sidebar className="border-r border-slate-200 dark:border-slate-700">
      <SidebarHeader className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">管理系統</h2>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-slate-600 dark:text-slate-400 font-medium">主要功能</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => navigate(item.path)}
                    isActive={location.pathname === item.path}
                    className={`w-full transition-all duration-200 ${
                      location.pathname === item.path 
                        ? 'bg-blue-500 text-white hover:bg-blue-600 font-medium shadow-sm' 
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    <item.icon size={20} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
