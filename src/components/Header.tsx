
import React from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { User } from 'lucide-react';

const Header = () => {
  return (
    <header className="sticky top-0 z-40 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <SidebarTrigger />
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-200">企業管理系統</h1>
        </div>
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100">
            <User className="h-4 w-4 mr-2" />
            用戶
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;
