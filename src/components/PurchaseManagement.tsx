
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';
import { PurchaseList } from './purchase/PurchaseList';
import { CreatePurchaseDialog } from './purchase/CreatePurchaseDialog';
import { PendingInventorySection } from './inventory/PendingInventorySection';

const PurchaseManagement = () => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">採購管理</h2>
        <Button 
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          新增採購單
        </Button>
      </div>
      
      <Tabs defaultValue="orders" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="orders" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">採購單</TabsTrigger>
          <TabsTrigger value="pending-inventory" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">待入庫</TabsTrigger>
        </TabsList>
        
        <TabsContent value="orders">
          <PurchaseList />
        </TabsContent>
        
        <TabsContent value="pending-inventory">
          <PendingInventorySection />
        </TabsContent>
      </Tabs>
      
      <CreatePurchaseDialog 
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </div>
  );
};

export default PurchaseManagement;
