
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';
import { InventoryList } from './inventory/InventoryList';
import { InventorySummary } from './inventory/InventorySummary';
import { CreateInventoryDialog } from './inventory/CreateInventoryDialog';

const InventoryManagement = () => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">庫存管理</h2>
        <Button 
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          新增入庫
        </Button>
      </div>
      
      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="summary" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">庫存統計</TabsTrigger>
          <TabsTrigger value="records" className="text-gray-900 data-[state=active]:text-gray-900 data-[state=inactive]:text-gray-600">入庫記錄</TabsTrigger>
        </TabsList>
        
        <TabsContent value="summary">
          <InventorySummary />
        </TabsContent>
        
        <TabsContent value="records">
          <InventoryList />
        </TabsContent>
      </Tabs>
      
      <CreateInventoryDialog 
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </div>
  );
};

export default InventoryManagement;
