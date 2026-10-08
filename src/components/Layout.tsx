
import React from 'react';
import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import Header from '@/components/Header';
import { RoutePermissionGuard } from '@/components/RoutePermissionGuard';

const Layout = ({ children }: { children?: React.ReactNode }) => {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <SidebarInset className="bg-background">
          <Header />
          <main className="flex-1 p-6 bg-background">
            <RoutePermissionGuard>{children || <Outlet />}</RoutePermissionGuard>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

export default Layout;
