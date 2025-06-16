
import React from 'react';
import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import Header from '@/components/Header';

const Layout = ({ children }: { children?: React.ReactNode }) => {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-white" style={{ backgroundColor: 'white' }}>
        <AppSidebar />
        <SidebarInset className="bg-white" style={{ backgroundColor: 'white' }}>
          <Header />
          <main className="flex-1 p-6 bg-white" style={{ backgroundColor: 'white' }}>
            {children || <Outlet />}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

export default Layout;
